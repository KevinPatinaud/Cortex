#!/usr/bin/env python3
# Managed by Cortex ops/lunaria-infra/install_system.py
"""Reviewed package maintenance and deferred runtime activation; no VPS reboot."""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request
from zoneinfo import ZoneInfo

import infra_health as infra

PACKAGES = ('nodejs', 'tzdata', 'linux-image-amd64', 'linux-image-cloud-amd64',
            'nginx', 'postgresql-17', 'redis-server', 'postfix', 'dovecot-core',
            'rspamd', 'fail2ban', 'certbot', 'openssl', 'systemd', 'libc6')
RUNTIME_TIMER = 'lunaria-infra-runtime.timer'
UPDATER_LOCK = Path('/home/kevin/.local/state/cortex-updater/update.lock')


def cortex_pid():
    return int(infra.text(infra.user_systemctl('show', 'cortex.service', '-p', 'MainPID', '--value')))


def runtime_current(pid):
    try:
        return Path('/proc', str(pid), 'exe').samefile('/usr/bin/node')
    except FileNotFoundError:
        return False


def inventory():
    versions = {}
    raw = infra.text(['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\t${db:Status-Status}\n', *PACKAGES], required=False)
    for line in raw.splitlines():
        name, version, status = line.split('\t')
        if status == 'installed':
            versions[name.split(':')[0]] = {'installed': version}
    current = None
    for line in infra.text(['apt-cache', 'policy', *versions]).splitlines():
        if line and not line.startswith(' ') and line.endswith(':'):
            current = line[:-1].split(':')[0]
        elif current in versions and line.strip().startswith('Candidate:'):
            versions[current]['candidate'] = line.split(':', 1)[1].strip()
    pid = cortex_pid()
    value = {'checkedAt': infra.utc_now(), 'kernelRunning': os.uname().release,
             'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
             'packages': versions, 'heldPackages': infra.text(['apt-mark', 'showhold']).splitlines(),
             'dpkgAuditClean': not bool(infra.text(['dpkg', '--audit'])),
             'rebootRequired': Path('/run/reboot-required').exists(),
             'cortexPid': pid, 'cortexUsesInstalledNode': runtime_current(pid)}
    infra.atomic_json(infra.STATE / 'inventory.json', value)
    return value


def verify_recent_backups():
    for kind in infra.BACKUPS:
        archive = infra.latest_backup(kind)
        proof = infra.read_state('restore-' + kind + '.json', {})
        recent = proof.get('verifiedAt') and (dt.datetime.now(dt.timezone.utc) -
                 dt.datetime.fromisoformat(proof['verifiedAt'])).total_seconds() < 86400
        if archive is None or time.time() - archive.stat().st_mtime > 86400:
            raise RuntimeError('Sauvegarde de moins de 24 h requise : ' + kind)
        if not (recent and proof.get('archive') == archive.name and
                proof.get('databaseRestoredInIsolation') and proof.get('temporaryDatabaseRemoved') and
                proof.get('archiveIntegrityVerified')):
            infra.verify_backup(kind)


def apt(args, cwd=None):
    result = subprocess.run(['apt-get', *args], cwd=cwd, capture_output=True, timeout=300,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8',
                                 'DEBIAN_FRONTEND': 'noninteractive', 'NEEDRESTART_MODE': 'l'})
    if result.returncode:
        raise RuntimeError('APT échoué : ' + infra.redact(result.stderr.decode(errors='replace')))
    return result.stdout.decode(errors='replace')


def reviewed_targets(targets, before):
    result = {}
    for target in targets:
        if '=' not in target:
            raise ValueError('Chaque paquet doit avoir une version exacte examinée')
        name, version = target.split('=', 1)
        if name not in ('nodejs', 'tzdata') or name in result or not re.fullmatch(r'[A-Za-z0-9.+:~_-]+', version):
            raise ValueError('Paquet ou version hors périmètre de cette procédure')
        state = before['packages'].get(name, {})
        if name in before['heldPackages'] or version != state.get('candidate'):
            raise RuntimeError('Paquet retenu ou candidat modifié ; refaire la revue')
        if name == 'nodejs' and version.split('.')[0] != state.get('installed', '').split('.')[0]:
            raise RuntimeError('Migration majeure Node : procédure distincte requise')
        if state.get('installed') != version:
            result[name] = version
    return result


def validate_apt_plan(plan, selected):
    changes = set(re.findall(r'^Inst ([^ :]+)', plan, re.M))
    if re.search(r'^Remv ', plan, re.M) or changes != set(selected):
        raise RuntimeError('APT prévoit des changements supplémentaires ; préserver le système')


def upgrade_packages(targets):
    before = inventory()
    if not before['dpkgAuditClean']:
        raise RuntimeError('Résoudre l’état dpkg avant une mise à jour')
    selected = reviewed_targets(targets, before)
    if not selected:
        return {'status': 'already-current'}
    verify_recent_backups()
    exact = [name + '=' + version for name, version in selected.items()]
    options = ['--only-upgrade', '--no-remove', '--no-install-recommends']
    validate_apt_plan(apt(['--simulate', *options, 'install', *exact]), selected)
    folder = infra.STATE / 'package-backups' / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    folder.mkdir(parents=True, mode=0o700)
    # Both old and new signed repository packages must be obtainable before mutation.
    apt(['download', *[name + '=' + before['packages'][name]['installed'] for name in selected]], cwd=folder)
    apt(['--download-only', '--assume-yes', *options, 'install', *exact])
    transaction = {'startedAt': infra.utc_now(), 'status': 'prepared', 'before': before,
                   'selected': selected, 'rollbackDirectory': str(folder),
                   'rollbackSha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.glob('*.deb')}}
    if len(transaction['rollbackSha256']) != len(selected):
        raise RuntimeError('Paquets de retour arrière incomplets')
    target = infra.STATE / 'package-maintenance.json'
    infra.atomic_json(target, transaction)
    infra.authorize_attempt('upgrade-packages')
    transaction['status'] = 'applying'
    infra.atomic_json(target, transaction)
    try:
        log = apt(['--assume-yes', '-o', 'Dpkg::Options::=--force-confold', *options, 'install', *exact])
        (folder / 'apt.log').write_text(log)
        (folder / 'apt.log').chmod(0o600)
        after = inventory()
        if not after['dpkgAuditClean'] or any(after['packages'][name]['installed'] != version for name, version in selected.items()):
            raise RuntimeError('Versions installées ou état dpkg non conformes')
        transaction.update(status='installed', after=after, finishedAt=infra.utc_now())
    except Exception as error:
        transaction.update(status='failed', error=infra.redact(error), finishedAt=infra.utc_now())
        raise
    finally:
        infra.atomic_json(target, transaction)
    return {'status': transaction['status'], 'versions': selected, 'rollbackDirectory': str(folder),
            'cortexRestartPending': not after['cortexUsesInstalledNode']}


def restart_window(now):
    local = now.astimezone(ZoneInfo('Europe/Paris'))
    start = local.replace(hour=4, minute=40, second=0, microsecond=0)
    end = local.replace(hour=5, minute=30, second=0, microsecond=0)
    if local >= end:
        start += dt.timedelta(days=1)
        end += dt.timedelta(days=1)
    return max(now, start.astimezone(dt.timezone.utc)), end.astimezone(dt.timezone.utc)


def plan_runtime_restart():
    if runtime_current(cortex_pid()):
        return {'status': 'already-current'}
    previous = infra.read_state('runtime-restart.json', {})
    if previous.get('status') in ('scheduled', 'deferred', 'restarting', 'failed'):
        raise RuntimeError('Réconcilier le plan précédent avant toute nouvelle planification')
    start, end = restart_window(dt.datetime.now(dt.timezone.utc))
    value = {'status': 'scheduled', 'requestedAt': infra.utc_now(), 'notBefore': start.isoformat(),
             'expiresAt': end.isoformat(), 'oldPid': cortex_pid(),
             'nodeSha256': hashlib.sha256(Path('/usr/bin/node').read_bytes()).hexdigest()}
    infra.atomic_json(infra.STATE / 'runtime-restart.json', value)
    infra.run(['systemctl', 'enable', '--now', RUNTIME_TIMER])
    return value


def queue_idle(pid):
    # Only the existing server credential is used; no environment or response body is logged.
    pairs = (Path('/proc') / str(pid) / 'environ').read_bytes().split(b'\0')
    values = dict(item.split(b'=', 1) for item in pairs if b'=' in item)
    password = values.get(b'CORTEX_PASSWORD', b'').decode()
    if not password:
        raise RuntimeError('État de la file inaccessible ; ne pas interrompre Cortex')
    base = 'http://127.0.0.1:3000'
    request = urllib.request.Request(base + '/api/auth/login', data=json.dumps({'password': password}).encode(),
                                     headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=5) as response:
        cookie = response.headers['Set-Cookie'].split(';', 1)[0]
    request = urllib.request.Request(base + '/api/execution-queue', headers={'Cookie': cookie})
    with urllib.request.urlopen(request, timeout=5) as response:
        value = json.load(response)
    if not isinstance(value.get('active'), list) or not isinstance(value.get('waiting'), list):
        raise RuntimeError('État de file inconnu ; préserver Cortex')
    return not value['active'] and not value['waiting']


def workers_idle(pid):
    group = (Path('/proc') / str(pid) / 'cgroup').read_text()
    for path in Path('/proc').glob('[0-9]*'):
        try:
            if int(path.name) == pid or (path / 'cgroup').read_text() != group:
                continue
            if Path(os.readlink(path / 'exe')).name != 'esbuild':
                return False
        except FileNotFoundError:
            continue
    return True


def run_runtime_restart():
    path = infra.STATE / 'runtime-restart.json'
    plan = infra.read_state(path.name, {})
    if plan.get('status') not in ('scheduled', 'deferred', 'restarting'):
        return {'status': 'no-pending-plan'}
    now = dt.datetime.now(dt.timezone.utc)
    if now < dt.datetime.fromisoformat(plan['notBefore']):
        return {'status': 'outside-window'}
    try:
        with infra.maintenance_lock(), UPDATER_LOCK.open('r+') as lease:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            pid = cortex_pid()
            if runtime_current(pid):
                snapshot = infra.collect()
                if snapshot['summary']['critical'] or snapshot['summary']['unknown']:
                    raise RuntimeError('Binaire actif mais retour des services non validé')
                plan.update(status='succeeded', verifiedAt=infra.utc_now(), newPid=pid, summary=snapshot['summary'])
            elif now >= dt.datetime.fromisoformat(plan['expiresAt']):
                plan.update(status='expired', nextAction='Revoir les travaux actifs et planifier une nouvelle fenêtre.')
            elif plan['status'] == 'restarting':
                plan.update(status='failed', nextAction='Réconcilier le redémarrage interrompu ; ne pas le répéter automatiquement.')
            else:
                if hashlib.sha256(Path('/usr/bin/node').read_bytes()).hexdigest() != plan['nodeSha256']:
                    raise RuntimeError('Binaire Node changé depuis la planification')
                # Global logical reservations and service children must both be idle.
                for attempt in range(2):
                    if cortex_pid() != pid or not queue_idle(pid) or not workers_idle(pid):
                        raise RuntimeError('Cortex occupé ; intervention différée')
                    if attempt == 0:
                        time.sleep(2)
                verify_recent_backups()
                snapshot = infra.collect()
                if snapshot['summary']['critical'] or snapshot['summary']['unknown']:
                    raise RuntimeError('Santé préalable dégradée ; intervention différée')
                if cortex_pid() != pid or not queue_idle(pid) or not workers_idle(pid):
                    raise RuntimeError('Cortex occupé ; intervention différée')
                infra.authorize_attempt('activate-node-runtime')
                plan.update(status='restarting', startedAt=infra.utc_now())
                infra.atomic_json(path, plan)
                infra.run(infra.user_systemctl('restart', 'cortex.service'), timeout=60)
                for _ in range(12):
                    time.sleep(5)
                    after = infra.collect()
                    if runtime_current(cortex_pid()) and after['summary']['critical'] == 0 and after['summary']['unknown'] == 0:
                        plan.update(status='succeeded', verifiedAt=infra.utc_now(), newPid=cortex_pid(), summary=after['summary'])
                        break
                else:
                    raise RuntimeError('Retour du runtime non validé ; examiner service et paquets de récupération')
    except Exception as error:
        plan.update(status='failed' if plan['status'] == 'restarting' else 'deferred', lastError=infra.redact(error), checkedAt=infra.utc_now())
    infra.atomic_json(path, plan)
    if plan['status'] in ('succeeded', 'failed', 'expired'):
        infra.run(['systemctl', 'disable', '--now', RUNTIME_TIMER])
    return plan


def validate_boot():
    snapshot = infra.collect()
    value = {'checkedAt': infra.utc_now(), 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
             'kernelRunning': os.uname().release, 'summary': snapshot['summary'],
             'status': 'succeeded' if snapshot['healthy'] else 'attention-required',
             'issues': [c['id'] for c in snapshot['checks'] if c['severity'] != 'ok']}
    infra.atomic_json(infra.STATE / 'boot-validation.json', value)
    inventory()
    return value


def dispatch(args):
    if args.command == 'runtime-maintenance':
        return run_runtime_restart()
    if args.command == 'validate-boot':
        return validate_boot()
    if args.command == 'inventory':
        return inventory()
    with infra.maintenance_lock():
        if args.command == 'upgrade-packages':
            return upgrade_packages(args.targets)
        if args.command == 'plan-runtime-restart':
            return plan_runtime_restart()
    raise ValueError('Action inconnue')
