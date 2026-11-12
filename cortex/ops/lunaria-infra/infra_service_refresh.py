#!/usr/bin/env python3
# Managed by Cortex ops/lunaria-infra/install_system.py
"""Explicitly planned activation of installed system libraries; no VPS reboot."""
import contextlib
import datetime as dt
import fcntl
from pathlib import Path
import socket
import time

import infra_health as infra
import infra_maintenance as maintenance

TIMER = 'lunaria-infra-services.timer'
STATE_FILE = 'service-refresh.json'
PROC = Path('/proc')
PACKAGE_LOCKS = (Path('/var/lib/dpkg/lock-frontend'), Path('/var/lib/dpkg/lock'))
CHECKS = {
    'postgresql@17-main.service': ['runuser', '-u', 'postgres', '--', '/usr/lib/postgresql/17/bin/postgres',
                                  '-D', '/var/lib/postgresql/17/main',
                                  '-c', 'config_file=/etc/postgresql/17/main/postgresql.conf', '-C', 'port'],
    'dovecot.service': ['doveconf', '-n'],
    'rspamd.service': ['rspamadm', 'configtest'],
    'fail2ban.service': ['fail2ban-client', '-t'],
    'ssh.service': ['/usr/sbin/sshd', '-t'],
}


def service_snapshot(unit):
    if unit not in CHECKS:
        raise ValueError('Service hors périmètre de cette maintenance')
    state = infra.unit_state(unit)
    if state.get('ActiveState') != 'active' or state.get('SubState') != 'running':
        raise RuntimeError('Service arrêté ou en transition : ' + unit)
    pid = int(infra.text(['systemctl', 'show', unit, '-p', 'MainPID', '--value']))
    if pid <= 1:
        raise RuntimeError('PID du service inconnu : ' + unit)
    paths = []
    for line in (PROC / str(pid) / 'maps').read_text().splitlines():
        parts = line.split(maxsplit=5)
        if len(parts) == 6 and parts[5].startswith(('/usr/', '/lib/')) and parts[5].endswith(' (deleted)'):
            paths.append(parts[5])
    return {'pid': pid, 'staleSystemMappings': sorted(set(paths))}


def inventory():
    value = {'checkedAt': infra.utc_now(), 'services': {u: service_snapshot(u) for u in CHECKS},
             'limits': ['Main process mappings only; existing SSH sessions are preserved.']}
    infra.atomic_json(infra.STATE / 'service-refresh-inventory.json', value)
    return value


def plan():
    previous = infra.read_state(STATE_FILE, {})
    if previous.get('status') in ('scheduled', 'deferred', 'running', 'failed'):
        raise RuntimeError('Réconcilier le plan de services précédent avant toute nouvelle planification')
    observed = inventory()
    units = [u for u, v in observed['services'].items() if v['staleSystemMappings']]
    if not units:
        return {'status': 'already-current'}
    start, end = maintenance.restart_window(dt.datetime.now(dt.timezone.utc))
    value = {'status': 'scheduled', 'requestedAt': infra.utc_now(), 'notBefore': start.isoformat(),
             'expiresAt': end.isoformat(), 'services': units, 'before': observed, 'results': {}}
    infra.atomic_json(infra.STATE / STATE_FILE, value)
    infra.run(['systemctl', 'enable', '--now', TIMER])
    return value


@contextlib.contextmanager
def package_locks():
    # APT/dpkg use POSIX locks, not flock. Do not race unattended upgrades.
    with contextlib.ExitStack() as stack:
        for path in PACKAGE_LOCKS:
            handle = stack.enter_context(path.open('r+'))
            fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def quiet(plan):
    if dt.datetime.now(dt.timezone.utc) >= dt.datetime.fromisoformat(plan['expiresAt']):
        raise RuntimeError('Fenêtre de maintenance terminée')
    pid = maintenance.cortex_pid()
    if not maintenance.queue_idle(pid) or not maintenance.workers_idle(pid):
        raise RuntimeError('Cortex occupé ; préserver les travaux actifs')
    for unit in [*infra.BACKUP_UNITS.values(), 'apt-daily-upgrade.service', 'certbot.service']:
        if infra.unit_state(unit).get('ActiveState') in ('active', 'activating', 'deactivating', 'reloading'):
            raise RuntimeError('Tâche technique active : ' + unit)
    if infra.sql('postgres', "SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() "
                 "AND backend_type = 'client backend' AND (state = 'active' OR xact_start IS NOT NULL)") != '0':
        raise RuntimeError('Transaction PostgreSQL active ; reporter la maintenance')


def verify_service(unit):
    for _ in range(15):
        try:
            result = service_snapshot(unit)
            if result['staleSystemMappings']:
                raise RuntimeError('Anciennes bibliothèques encore chargées')
            if unit == 'ssh.service':
                with socket.create_connection(('127.0.0.1', 22), timeout=3) as client:
                    if not client.recv(256).startswith(b'SSH-2.0-'):
                        raise RuntimeError('Bannière SSH non validée')
            health = infra.collect()
            if health['summary']['critical'] or health['summary']['unknown']:
                raise RuntimeError('Retour des services non validé')
            return {**result, 'summary': health['summary'], 'verifiedAt': infra.utc_now()}
        except (RuntimeError, OSError, ValueError):
            time.sleep(2)
    raise RuntimeError('Activation non validée : ' + unit)


def run_locked():
    path = infra.STATE / STATE_FILE
    value = infra.read_state(STATE_FILE, {})
    if value.get('status') not in ('scheduled', 'deferred', 'running'):
        if value.get('status') in ('succeeded', 'expired', 'failed'):
            infra.run(['systemctl', 'disable', '--now', TIMER])
        return {'status': 'no-pending-plan'}
    now = dt.datetime.now(dt.timezone.utc)
    try:
        if value['status'] == 'running':
            raise RuntimeError('Intervention interrompue ; réconcilier sans répéter les actions')
        if now < dt.datetime.fromisoformat(value['notBefore']):
            return {'status': 'outside-window'}
        if now >= dt.datetime.fromisoformat(value['expiresAt']):
            value.update(status='expired', nextAction='Revoir les travaux actifs avant une nouvelle fenêtre.')
        else:
            units = value['services']
            if not units or len(set(units)) != len(units) or any(u not in CHECKS for u in units):
                raise ValueError('Liste de services non autorisée')
            maintenance.verify_recent_backups()
            quiet(value)
            for unit in units:
                service_snapshot(unit)
                infra.run(CHECKS[unit], timeout=30)
            health = infra.collect()
            if health['summary']['critical'] or health['summary']['unknown']:
                raise RuntimeError('Santé préalable dégradée')
            time.sleep(2)
            for unit in units:
                quiet(value)
                before = service_snapshot(unit)
                if not before['staleSystemMappings']:
                    value['results'][unit] = {'status': 'already-current', 'pid': before['pid']}
                    continue
                infra.authorize_attempt('refresh-libraries:' + unit)
                value.update(status='running', currentService=unit)
                value['results'][unit] = {'status': 'refreshing', 'before': before}
                infra.atomic_json(path, value)
                # OpenSSH SIGHUP re-execs its listener and preserves established sessions.
                action = 'reload' if unit == 'ssh.service' else 'restart'
                infra.run(['systemctl', action, unit], timeout=60)
                value['results'][unit].update(status='succeeded', after=verify_service(unit), action=action)
                infra.atomic_json(path, value)
            value.pop('currentService', None)
            value.update(status='succeeded', verifiedAt=infra.utc_now())
    except Exception as error:
        value.update(status='failed' if value['status'] == 'running' else 'deferred',
                     lastError=infra.redact(error), checkedAt=infra.utc_now())
    infra.atomic_json(path, value)
    if value['status'] in ('succeeded', 'failed', 'expired'):
        infra.run(['systemctl', 'disable', '--now', TIMER])
    return value


def run():
    try:
        with infra.maintenance_lock(), maintenance.UPDATER_LOCK.open('r+') as lease:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with package_locks():
                return run_locked()
    except (RuntimeError, OSError) as error:
        # Never overwrite another worker's durable plan when a lock is unavailable.
        return {'status': 'busy', 'detail': infra.redact(error)}
