#!/usr/bin/env python3
# Managed by Cortex ops/lunaria-infra/install_system.py
"""Local infrastructure evidence and bounded repairs; never restores production data.

Installed root-owned and called by /usr/local/sbin/lunaria-infra. The periodic
probe is passive: only the scheduled Cortex agent decides on repairs.
"""
import argparse
import contextlib
import datetime as dt
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import uuid

STATE = Path('/var/lib/lunaria-infra')
DEPLOY_LOCK = Path('/home/kevin/.lunaria-deploy.lock')
MAINTENANCE_LOCK = Path('/run/lock/lunaria-infra.lock')
SERVICES = ('nginx.service', 'lunaria-backend.service', 'postgresql@17-main.service',
            'postfix.service', 'dovecot.service', 'rspamd.service', 'redis-server.service', 'fail2ban.service')
TIMERS = ('certbot.timer', 'lunaria-backup.timer', 'lunaria-mail-backup.timer', 'lunaria-mail-revoke.timer', 'lunaria-infra-probe.timer')
BACKUPS = {'site': Path('/var/backups/lunaria'), 'mail': Path('/var/backups/lunaria-mail')}
BACKUP_UNITS = {'site': 'lunaria-backup.service', 'mail': 'lunaria-mail-backup.service'}
URLS = {'site': 'https://savelunaria.com/', 'backend': 'http://127.0.0.1:8081/actuator/health',
        'cortex': 'http://127.0.0.1:3000/'}
DOMAINS = ('savelunaria.com', 'cortex.savelunaria.com')
VERSION = '1.0.0'


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def redact(value):
    value = re.sub(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', '[adresse masquée]', str(value))
    value = re.sub(r'(?i)(authorization\s*[=:]\s*)(?:bearer\s+|basic\s+)?[^\s,;]+', r'\1[masqué]', value)
    value = re.sub(r'(?i)((?:password|passwd|token|authorization|secret|api[_-]?key)\s*[=:]\s*)\S+', r'\1[masqué]', value)
    value = re.sub(r'(https?://[^\s?]+)\?[^\s]+', r'\1?[masqué]', value)
    return value[:2400]


def run(args, timeout=20, data=None, required=True):
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'})
    if required and result.returncode:
        raise RuntimeError('Commande échouée (' + str(result.returncode) + ') : ' + args[0] + ': ' + redact(result.stderr.decode(errors='replace')))
    return result


def text(args, timeout=20, required=True):
    return run(args, timeout, required=required).stdout.decode(errors='replace').strip()


def user_systemctl(*args):
    uid = pwd.getpwnam('kevin').pw_uid
    return ['runuser', '-u', 'kevin', '--', 'env', 'XDG_RUNTIME_DIR=/run/user/' + str(uid),
            'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/' + str(uid) + '/bus', 'systemctl', '--user', *args]


def unit_state(name, user=False):
    properties = ['Id', 'LoadState', 'ActiveState', 'SubState', 'Result', 'ExecMainStatus', 'ExecMainExitTimestamp', 'UnitFileState']
    command = user_systemctl('show', name) if user else ['systemctl', 'show', name]
    for key in properties:
        command += ['-p', key]
    raw = text(command)
    return dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.chmod(temporary, 0o640)
        if os.geteuid() == 0:
            os.chown(temporary, 0, pwd.getpwnam('kevin').pw_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_state(name, default):
    try:
        return json.loads((STATE / name).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def add_check(checks, key, severity, detail, **evidence):
    checks.append({'id': key, 'severity': severity, 'detail': redact(detail), 'evidence': evidence})


def threshold(value, warning, critical, lower=False):
    if lower:
        return 'critical' if value <= critical else 'warning' if value <= warning else 'ok'
    return 'critical' if value >= critical else 'warning' if value >= warning else 'ok'


def latest_backup(kind):
    files = [path for path in BACKUPS[kind].glob('20*T*Z.tar.gz') if path.is_file() and not path.is_symlink()]
    return max(files, key=lambda path: path.stat().st_mtime) if files else None


def collect():
    checks = []
    for name in SERVICES + TIMERS:
        try:
            state = unit_state(name)
            add_check(checks, 'unit:' + name, 'ok' if state.get('ActiveState') == 'active' else 'critical',
                      name + ': ' + state.get('ActiveState', 'unknown'), **state)
        except Exception as error:
            add_check(checks, 'unit:' + name, 'unknown', str(error))
    try:
        state = unit_state('cortex.service', user=True)
        add_check(checks, 'unit:cortex.service', 'ok' if state.get('ActiveState') == 'active' else 'critical',
                  'Cortex : ' + state.get('ActiveState', 'unknown'), **state)
    except Exception as error:
        add_check(checks, 'unit:cortex.service', 'unknown', str(error))
    for key, url in URLS.items():
        started = time.monotonic()
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                body = response.read(8192)
                good = response.status == 200 and (key != 'backend' or json.loads(body).get('status') == 'UP')
                add_check(checks, 'http:' + key, 'ok' if good else 'critical', 'Réponse applicative vérifiée',
                          status=response.status, milliseconds=round((time.monotonic() - started) * 1000))
        except Exception as error:
            add_check(checks, 'http:' + key, 'critical', str(error))
    for domain in DOMAINS:
        try:
            with ssl.create_default_context().wrap_socket(socket.create_connection((domain, 443), timeout=5), server_hostname=domain) as connection:
                certificate = connection.getpeercert()
            days = (ssl.cert_time_to_seconds(certificate['notAfter']) - time.time()) / 86400
            add_check(checks, 'tls:' + domain, threshold(days, 21, 7, lower=True), 'Certificat TLS valide',
                      expiresAt=certificate['notAfter'], daysRemaining=round(days, 1))
        except Exception as error:
            add_check(checks, 'tls:' + domain, 'critical', str(error))
    for port in [587, 993]:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=3):
                pass
            add_check(checks, 'mail-port:' + str(port), 'ok', 'Port local de messagerie accessible')
        except Exception as error:
            add_check(checks, 'mail-port:' + str(port), 'critical', str(error))
    try:
        result = text(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-At', '-d', 'lunaria', '-c', 'SELECT 1'], timeout=8)
        add_check(checks, 'database:query', 'ok' if result == '1' else 'critical', 'Requête de santé PostgreSQL')
    except Exception as error:
        add_check(checks, 'database:query', 'critical', str(error))
    disk = shutil.disk_usage('/')
    percent = disk.used * 100 / disk.total
    add_check(checks, 'disk:root', 'critical' if disk.free < 1024**3 else threshold(percent, 85, 95),
              'Occupation du disque', usedPercent=round(percent, 1), availableBytes=disk.free)
    inodes = os.statvfs('/')
    used = 100 * (inodes.f_files - inodes.f_ffree) / max(1, inodes.f_files)
    add_check(checks, 'disk:inodes', threshold(used, 85, 95), 'Occupation des inodes', usedPercent=round(used, 1))
    memory = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        memory[key] = int(value.strip().split()[0]) * 1024
    available = 100 * memory['MemAvailable'] / memory['MemTotal']
    add_check(checks, 'memory:available', threshold(available, 10, 5, lower=True), 'Mémoire disponible',
              availableBytes=memory['MemAvailable'], availablePercent=round(available, 1))
    load = os.getloadavg()
    add_check(checks, 'cpu:load', threshold(load[1] / max(1, os.cpu_count()), 1.5, 3),
              'Charge moyenne sur cinq minutes', load5=load[1], processors=os.cpu_count())
    for kind in BACKUPS:
        try:
            archive = latest_backup(kind)
            state = unit_state(BACKUP_UNITS[kind])
            age = (time.time() - archive.stat().st_mtime) / 3600 if archive else None
            severity = 'critical' if archive is None or age > 48 else 'warning' if age > 30 or state.get('Result') not in ['', 'success'] else 'ok'
            add_check(checks, 'backup:' + kind, severity, 'Fraîcheur de sauvegarde et dernier résultat de la tâche',
                      archive=archive.name if archive else None, hoursOld=round(age, 1) if age is not None else None,
                      bytes=archive.stat().st_size if archive else 0, taskResult=state.get('Result'))
        except Exception as error:
            add_check(checks, 'backup:' + kind, 'unknown', str(error))
    try:
        queue = [json.loads(line) for line in text(['postqueue', '-j'], timeout=8).splitlines() if line.strip()]
        age = max([time.time() - item.get('arrival_time', time.time()) for item in queue] or [0])
        add_check(checks, 'mail:queue', 'critical' if len(queue) > 100 else 'warning' if age > 3600 else 'ok',
                  'File de messagerie : compte et ancienneté uniquement', count=len(queue), oldestSeconds=round(age))
    except Exception as error:
        add_check(checks, 'mail:queue', 'unknown', str(error))
    try:
        failed = []
        for line in text(['systemctl', '--failed', '--plain', '--no-legend', '--no-pager']).splitlines():
            unit = line.split()[0] if line.split() else ''
            if re.fullmatch(r'[A-Za-z0-9_.@\-]+\.(service|timer|socket|mount)', unit):
                failed.append(unit)
        add_check(checks, 'system:failed-units', 'warning' if failed else 'ok', 'Unités système en échec', units=failed)
    except Exception as error:
        add_check(checks, 'system:failed-units', 'unknown', str(error))
    add_check(checks, 'system:reboot-requested', 'warning' if Path('/run/reboot-required').exists() else 'ok',
              'Indicateur système de redémarrage requis ; aucun redémarrage automatique')
    previous = read_state('current.json', {})
    old = {item['id']: item for item in previous.get('checks', [])}
    for item in checks:
        failing = item['severity'] != 'ok'
        last = old.get(item['id'], {})
        item['consecutiveFailures'] = (last.get('consecutiveFailures', 0) + 1) if failing else 0
    snapshot = {'schemaVersion': 1, 'version': VERSION, 'checkedAt': utc_now(), 'checks': checks,
                'healthy': all(item['severity'] == 'ok' for item in checks),
                'summary': {severity: sum(item['severity'] == severity for item in checks) for severity in ['ok', 'warning', 'critical', 'unknown']},
                'limits': ['Sonde locale : une panne complète du VPS nécessite une surveillance extérieure.',
                           'Ports mail vérifiés sans envoi de message et sans lecture des boîtes.',
                           'Le succès d’une sauvegarde ne prouve sa restauration que lorsqu’un contrôle isolé a été effectué.']}
    atomic_json(STATE / 'current.json', snapshot)
    history = STATE / 'history.jsonl'
    if history.exists() and history.stat().st_size > 8 * 1024 * 1024:
        os.replace(history, STATE / 'history.previous.jsonl')
    with history.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'checkedAt': snapshot['checkedAt'], 'summary': snapshot['summary'],
            'issues': [item['id'] for item in checks if item['severity'] != 'ok']}, ensure_ascii=False) + '\n')
    os.chmod(history, 0o640)
    if os.geteuid() == 0:
        os.chown(history, 0, pwd.getpwnam('kevin').pw_gid)
    return snapshot


@contextlib.contextmanager
def maintenance_lock():
    import fcntl
    handles = []
    try:
        for path in [MAINTENANCE_LOCK, DEPLOY_LOCK]:
            if path.exists() and path.is_symlink():
                raise RuntimeError('Un verrou est un lien symbolique ; préserver le système')
            existed = path.exists()
            descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            if path == DEPLOY_LOCK and not existed:
                account = pwd.getpwnam('kevin')
                os.fchown(descriptor, account.pw_uid, account.pw_gid)
            handle = os.fdopen(descriptor, 'a')
            handles.append(handle)
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('Une maintenance ou un déploiement Lunaria est en cours ; reporter cette réparation') from None
        yield
    finally:
        for handle in reversed(handles):
            handle.close()


def authorize_attempt(action):
    state = read_state('attempts.json', {})
    now = time.time()
    attempts = [value for value in state.get(action, []) if now - value < 6 * 3600]
    if attempts and now - attempts[-1] < 10 * 60:
        raise RuntimeError('Temporisation : attendre dix minutes avant une nouvelle tentative identique')
    if len(attempts) >= 2:
        raise RuntimeError('Deux tentatives en six heures ; diagnostiquer la cause et préserver le service')
    state[action] = [*attempts, now]
    atomic_json(STATE / 'attempts.json', state)


def record_action(value):
    atomic_json(STATE / 'last-action.json', value)
    journal = STATE / 'actions.jsonl'
    if journal.exists() and journal.stat().st_size > 4 * 1024 * 1024:
        os.replace(journal, STATE / 'actions.previous.jsonl')
    with journal.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps(value, ensure_ascii=False) + '\n')
    os.chmod(journal, 0o640)
    if os.geteuid() == 0:
        os.chown(journal, 0, pwd.getpwnam('kevin').pw_gid)


def sql(database, query):
    return text(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', query], timeout=45)


def safe_member(name):
    path = PurePosixPath(name)
    return not path.is_absolute() and '..' not in path.parts and '\\' not in name


def check_restore_name(name):
    if not re.fullmatch(r'lunaria_infra_restore_[0-9a-f]{16}', name):
        raise ValueError('Nom de base temporaire non autorisé')


def verify_backup(kind):
    archive = latest_backup(kind)
    if archive is None:
        raise RuntimeError('Aucune sauvegarde disponible')
    run(['gzip', '-t', str(archive)], timeout=120)
    if kind == 'mail':
        checksum_file = Path(str(archive) + '.sha256')
        if not checksum_file.is_file():
            raise RuntimeError('Empreinte de sauvegarde mail absente')
        expected = checksum_file.read_text().split()[0]
        with archive.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if not re.fullmatch(r'[0-9a-f]{64}', expected) or digest != expected:
            raise RuntimeError('Empreinte de sauvegarde mail incorrecte')
    with tarfile.open(archive, 'r:gz') as package:
        members = package.getmembers()
        if any(not safe_member(member.name) or not (member.isfile() or member.isdir()) for member in members):
            raise RuntimeError('Structure de sauvegarde inattendue')
        names = {member.name for member in members}
        required = {'database.dump', 'media.tar.gz', 'backend.env'} if kind == 'site' else {'database.dump', 'config.tar.gz'}
        if not required.issubset(names):
            raise RuntimeError('Sauvegarde incomplète')
        dump_member = package.getmember('database.dump')
        if dump_member.size > 512 * 1024 * 1024 or shutil.disk_usage('/').free < max(2 * 1024**3, dump_member.size * 6):
            raise RuntimeError('Ressources insuffisantes pour une restauration de contrôle sûre')
        dump = package.extractfile(dump_member).read()
        inner_name = 'media.tar.gz' if kind == 'site' else 'config.tar.gz'
        with package.extractfile(inner_name) as inner:
            with gzip.GzipFile(fileobj=inner) as compressed:
                with tempfile.TemporaryFile() as scratch:
                    copied = 0
                    while chunk := compressed.read(1024 * 1024):
                        copied += len(chunk)
                        if copied > 512 * 1024 * 1024:
                            raise RuntimeError('Archive interne trop volumineuse pour ce contrôle')
                        scratch.write(chunk)
                    scratch.seek(0)
                    with tarfile.open(fileobj=scratch, mode='r:') as inner_package:
                        if any(not safe_member(item.name) for item in inner_package.getmembers()):
                            raise RuntimeError('Chemin inattendu dans l’archive interne')
        mailbox_files = sum(member.isfile() and member.name.startswith('mail/') for member in members) if kind == 'mail' else None
    database = 'lunaria_infra_restore_' + uuid.uuid4().hex[:16]
    check_restore_name(database)
    created = False
    try:
        run(['runuser', '-u', 'postgres', '--', 'createdb', '--template=template0', database], timeout=30)
        created = True
        run(['runuser', '-u', 'postgres', '--', 'pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '--dbname=' + database], timeout=180, data=dump)
        tables = set(sql(database, "SELECT tablename FROM pg_tables WHERE schemaname='public'").splitlines())
        if not {'article', 'launch_subscription', 'mail_address'}.issubset(tables):
            raise RuntimeError('Tables applicatives attendues absentes après restauration')
        counts = {table: int(sql(database, 'SELECT count(*) FROM ' + table)) for table in ['article', 'launch_subscription', 'mail_address']}
    finally:
        if created:
            check_restore_name(database)
            run(['runuser', '-u', 'postgres', '--', 'dropdb', '--if-exists', database], timeout=30)
    result = {'kind': kind, 'archive': archive.name, 'verifiedAt': utc_now(), 'databaseRestoredInIsolation': True,
              'temporaryDatabaseRemoved': True, 'publicTableCount': len(tables), 'aggregateCounts': counts,
              'archiveIntegrityVerified': True, 'mailboxArchiveFiles': mailbox_files,
              'limits': ['Aucune restauration dans la base active ou les boîtes réelles.',
                         'Le contrôle mail valide l’archive et sa base ; il ne rejoue pas un import Dovecot complet.']}
    atomic_json(STATE / ('restore-' + kind + '.json'), result)
    return result


def repair_service(name):
    if name not in SERVICES and name != 'cortex.service':
        raise ValueError('Service hors périmètre')
    state = unit_state(name, user=name == 'cortex.service')
    if state.get('LoadState') != 'loaded':
        raise RuntimeError('Unité non installée ; ne pas inventer sa configuration')
    if state.get('ActiveState') in ['activating', 'deactivating', 'reloading']:
        raise RuntimeError('Transition de service en cours ; attendre avant intervention')
    if name == 'cortex.service' and state.get('ActiveState') == 'active':
        raise RuntimeError('Ne pas interrompre le Cortex qui exécute la mission ; préparer une reprise distincte si nécessaire')
    if name == 'nginx.service':
        run(['nginx', '-t'])
    if name == 'postfix.service':
        run(['postfix', 'check'])
    if name == 'dovecot.service':
        run(['doveconf', '-n'])
    command = user_systemctl('restart', name) if name == 'cortex.service' else ['systemctl', 'restart', name]
    run(command, timeout=60)
    after = unit_state(name, user=name == 'cortex.service')
    if after.get('ActiveState') != 'active':
        raise RuntimeError('Le service n’est pas rétabli')
    return {'service': name, 'before': state.get('ActiveState'), 'after': after.get('ActiveState')}


def execute_action(action, target=None):
    with maintenance_lock():
        identity = action + (':' + target if target else '')
        authorize_attempt(identity)
        started = utc_now()
        try:
            if action == 'repair-service':
                result = repair_service(target)
            elif action == 'backup':
                before = latest_backup(target)
                run(['systemctl', 'start', BACKUP_UNITS[target]], timeout=240)
                after = latest_backup(target)
                if after is None or (before is not None and after.name == before.name):
                    raise RuntimeError('Aucune nouvelle archive confirmée')
                result = {'kind': target, 'archive': after.name}
            elif action == 'verify-backup':
                result = verify_backup(target)
            elif action == 'enable-timer':
                if target not in TIMERS:
                    raise ValueError('Timer hors périmètre')
                run(['systemctl', 'enable', '--now', target])
                state = unit_state(target)
                if state.get('ActiveState') != 'active':
                    raise RuntimeError('Le timer reste inactif')
                result = {'timer': target, 'active': True}
            elif action == 'renew-tls':
                run(['systemctl', 'start', 'certbot.service'], timeout=240)
                state = unit_state('certbot.service')
                if state.get('Result') != 'success':
                    raise RuntimeError('Le renouvellement n’a pas réussi')
                result = {'taskResult': state['Result'], 'note': 'Vérifier ensuite les certificats réellement servis.'}
            elif action == 'clear-stale-exim':
                state = unit_state('exim4-base.timer')
                if state.get('LoadState') != 'not-found' or state.get('ActiveState') != 'failed' or unit_state('postfix.service').get('ActiveState') != 'active':
                    raise RuntimeError('Les conditions du reliquat Exim ne sont pas établies')
                run(['systemctl', 'reset-failed', 'exim4-base.timer'])
                result = {'cleared': 'exim4-base.timer', 'unitFilesModified': False}
            else:
                raise ValueError('Action inconnue')
            record_action({'action': identity, 'startedAt': started, 'finishedAt': utc_now(), 'status': 'succeeded', 'result': result})
            return result
        except Exception as error:
            record_action({'action': identity, 'startedAt': started, 'finishedAt': utc_now(), 'status': 'failed', 'error': redact(error)})
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='command', required=True)
    for name in ['version', 'collect', 'status', 'renew-tls', 'clear-stale-exim']:
        subs.add_parser(name)
    service = subs.add_parser('repair-service')
    service.add_argument('target', choices=[*SERVICES, 'cortex.service'])
    timer = subs.add_parser('enable-timer')
    timer.add_argument('target', choices=TIMERS)
    for name in ['backup', 'verify-backup']:
        sub = subs.add_parser(name)
        sub.add_argument('target', choices=BACKUPS)
    args = parser.parse_args()
    if args.command == 'version':
        print(VERSION)
        return
    if args.command == 'status':
        value = read_state('current.json', {})
        if not value.get('checkedAt'):
            raise RuntimeError('Aucun relevé de santé disponible')
        print(json.dumps(value, ensure_ascii=False))
        return
    if os.geteuid() != 0:
        raise PermissionError('Exécuter cet outil via le helper sudo installé')
    result = collect() if args.command == 'collect' else execute_action(args.command, getattr(args, 'target', None))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': redact(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
