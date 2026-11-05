#!/usr/bin/env python3
"""Install the passive system probe and root-owned repair tool; no new sudo rights."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import pwd
import shutil
import stat
import subprocess
import tempfile

from infra_health import atomic_json, maintenance_lock, utc_now

LIBRARY = Path('/usr/local/lib/lunaria-infra')
HELPER = Path('/usr/local/sbin/lunaria-infra')
STATE = Path('/var/lib/lunaria-infra')
UNIT = Path('/etc/systemd/system/lunaria-infra-probe.service')
TIMER = Path('/etc/systemd/system/lunaria-infra-probe.timer')
BOOT_UNIT = UNIT.with_name('lunaria-infra-boot.service')
BOOT_TIMER = TIMER.with_name('lunaria-infra-boot.timer')
RUNTIME_UNIT = UNIT.with_name('lunaria-infra-runtime.service')
RUNTIME_TIMER = TIMER.with_name('lunaria-infra-runtime.timer')
RESOLVER = Path('/etc/systemd/resolved.conf.d/70-lunaria-infra.conf')
RESOLVER_TEXT = '''# Managed by Cortex ops/lunaria-infra/install_system.py
[Resolve]
LLMNR=no
MulticastDNS=no
'''

SERVICE_TEXT = '''# Managed by Cortex ops/lunaria-infra/install_system.py
[Unit]
Description=Lunaria passive infrastructure health probe
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/lunaria-infra collect
User=root
UMask=0027
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=120
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/lunaria-infra
StandardOutput=null
StandardError=journal
'''
TIMER_TEXT = '''# Managed by Cortex ops/lunaria-infra/install_system.py
[Unit]
Description=Check Lunaria infrastructure every five minutes without AI inference

[Timer]
OnBootSec=90s
OnUnitActiveSec=5min
AccuracySec=15s
RandomizedDelaySec=10s
Unit=lunaria-infra-probe.service

[Install]
WantedBy=timers.target
'''
HELPER_TEXT = '''#!/bin/sh
# Managed by Cortex ops/lunaria-infra/install_system.py
exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 /usr/bin/python3 -I /usr/local/lib/lunaria-infra/infra_health.py "$@"
'''
BOOT_SERVICE_TEXT = SERVICE_TEXT.replace('passive infrastructure health probe', 'post-boot infrastructure validation').replace(
    'lunaria-infra collect', 'lunaria-infra validate-boot')
BOOT_TIMER_TEXT = '''# Managed by Cortex ops/lunaria-infra/install_system.py
[Unit]
Description=Validate Lunaria services after every boot independently of Cortex

[Timer]
OnBootSec=3min
AccuracySec=15s
Unit=lunaria-infra-boot.service

[Install]
WantedBy=timers.target
'''
RUNTIME_SERVICE_TEXT = '''# Managed by Cortex ops/lunaria-infra/install_system.py
[Unit]
Description=Execute an explicitly planned Lunaria Node runtime activation
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/lunaria-infra runtime-maintenance
User=root
UMask=0027
TimeoutStartSec=300
StandardOutput=null
StandardError=journal
'''
RUNTIME_TIMER_TEXT = '''# Managed by Cortex ops/lunaria-infra/install_system.py
[Unit]
Description=Check a pending runtime maintenance plan without AI inference

[Timer]
OnCalendar=minutely
AccuracySec=1s
Persistent=true
Unit=lunaria-infra-runtime.service

[Install]
WantedBy=timers.target
'''


def resolver_query():
    subprocess.run(['resolvectl', 'query', 'savelunaria.com', 'cortex.savelunaria.com', 'github.com'],
                   check=True, capture_output=True, timeout=20)


def write_resolver(content):
    descriptor, temporary = tempfile.mkstemp(prefix='.lunaria-', dir=RESOLVER.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(content)
        os.chmod(temporary, 0o644)
        os.replace(temporary, RESOLVER)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def harden_dns_resolver(backup):
    directory = RESOLVER.parent
    if directory.is_symlink() or RESOLVER.is_symlink():
        raise RuntimeError('Chemin resolved inattendu ; préserver la configuration')
    existed = directory.exists()
    mode_before = stat.S_IMODE(directory.stat().st_mode) if existed else None
    if existed and (not directory.is_dir() or directory.stat().st_uid != os.geteuid()):
        raise RuntimeError('Répertoire resolved inattendu ; préserver ses permissions')
    # A restrictive directory can hide drop-ins from the unprivileged resolver.
    # Only repair an empty directory or one containing our own managed file.
    repair_mode = existed and mode_before & 0o005 != 0o005
    if repair_mode and any(path != RESOLVER for path in directory.iterdir()):
        raise RuntimeError('Préserver les permissions des configurations resolved inconnues')
    before = RESOLVER.read_bytes() if RESOLVER.exists() else None
    if before is not None and b'Managed by Cortex ops/lunaria-infra/install_system.py' not in before:
        raise RuntimeError('Préserver le fichier resolved inconnu')
    resolver_query()
    atomic_json(backup / 'resolver-before.json', {'directoryExisted': existed, 'directoryMode': mode_before,
                                                'fileExisted': before is not None})
    if before is not None:
        shutil.copy2(RESOLVER, backup / RESOLVER.name)
    try:
        directory.mkdir(parents=True, exist_ok=True, mode=0o755)
        if not existed or repair_mode:
            directory.chmod(0o755)
        write_resolver(RESOLVER_TEXT.encode())
        subprocess.run(['systemctl', 'restart', 'systemd-resolved.service'], check=True, capture_output=True, timeout=30)
        resolver_query()
        ports = subprocess.run(['ss', '-H', '-lntu', 'sport = :5355'], check=True, capture_output=True, text=True)
        if ports.stdout.strip():
            raise RuntimeError('LLMNR écoute encore après durcissement')
        atomic_json(STATE / 'resolver-hardening.json', {'checkedAt': utc_now(), 'status': 'succeeded',
                    'dnsValidated': True, 'llmnrListeners': 0, 'directoryMode': stat.S_IMODE(directory.stat().st_mode),
                    'backupDirectory': str(backup)})
    except Exception as error:
        evidence = {'checkedAt': utc_now(), 'status': 'rollback-required', 'error': str(error),
                    'backupDirectory': str(backup)}
        atomic_json(STATE / 'resolver-hardening.json', evidence)
        try:
            if before is None:
                RESOLVER.unlink(missing_ok=True)
            else:
                write_resolver(before)
                shutil.copystat(backup / RESOLVER.name, RESOLVER)
            if existed:
                directory.chmod(mode_before)
            else:
                directory.rmdir()
            subprocess.run(['systemctl', 'restart', 'systemd-resolved.service'], check=True, capture_output=True, timeout=30)
            resolver_query()
        except Exception as recovery_error:
            evidence['rollbackError'] = str(recovery_error)
            atomic_json(STATE / 'resolver-hardening.json', evidence)
            raise RuntimeError('Retour arrière DNS non validé ; examiner les preuves privées') from recovery_error
        evidence.update(status='rolled-back', rollbackDnsValidated=True)
        atomic_json(STATE / 'resolver-hardening.json', evidence)
        raise


def install(harden_resolver=False):
    if os.geteuid() != 0:
        raise PermissionError('Installer avec sudo')
    with maintenance_lock():
        return install_locked(harden_resolver)


def install_locked(harden_resolver):
    account = pwd.getpwnam('kevin')
    for directory in [LIBRARY, STATE]:
        if directory.is_symlink():
            raise RuntimeError('Répertoire de gestion inattendu')
        directory.mkdir(parents=True, exist_ok=True)
    os.chown(LIBRARY, 0, 0)
    os.chmod(LIBRARY, 0o755)
    os.chown(STATE, 0, account.pw_gid)
    os.chmod(STATE, 0o750)
    source = Path(__file__).parent / 'infra_health.py'
    files = {LIBRARY / 'infra_health.py': (source.read_text(), 0o644), HELPER: (HELPER_TEXT, 0o755),
             LIBRARY / 'infra_maintenance.py': ((source.parent / 'infra_maintenance.py').read_text(), 0o644),
             UNIT: (SERVICE_TEXT, 0o644), TIMER: (TIMER_TEXT, 0o644),
             BOOT_UNIT: (BOOT_SERVICE_TEXT, 0o644), BOOT_TIMER: (BOOT_TIMER_TEXT, 0o644),
             RUNTIME_UNIT: (RUNTIME_SERVICE_TEXT, 0o644), RUNTIME_TIMER: (RUNTIME_TIMER_TEXT, 0o644)}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = STATE / 'installation-backups' / stamp
    backup.mkdir(parents=True, exist_ok=True, mode=0o700)
    changed = []
    for target, (content, mode) in files.items():
        if target.is_symlink():
            raise RuntimeError('Fichier de gestion inattendu : ' + str(target))
        if target.exists() and target.read_text() == content:
            continue
        if target.exists():
            if 'Managed by Cortex ops/lunaria-infra/install_system.py' not in target.read_text():
                raise RuntimeError('Préserver le fichier inconnu : ' + str(target))
            shutil.copy2(target, backup / target.name)
        temporary = target.with_name(target.name + '.installing')
        temporary.write_text(content)
        os.chown(temporary, 0, 0)
        os.chmod(temporary, mode)
        os.replace(temporary, target)
        changed.append(str(target))
    subprocess.run(['systemd-analyze', 'verify', *map(str, [UNIT, TIMER, BOOT_UNIT, BOOT_TIMER, RUNTIME_UNIT, RUNTIME_TIMER])], check=True, capture_output=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', TIMER.name], check=True, capture_output=True)
    subprocess.run(['systemctl', 'enable', '--now', BOOT_TIMER.name], check=True, capture_output=True)
    if harden_resolver:
        harden_dns_resolver(backup)
        changed.append(str(RESOLVER))
    subprocess.run(['systemctl', 'start', UNIT.name], check=True, timeout=130)
    print(json.dumps({'helper': str(HELPER), 'passiveProbeTimer': TIMER.name, 'probeInterval': '5min',
        'changed': changed, 'rootToolSha256': hashlib.sha256((LIBRARY / 'infra_health.py').read_bytes()).hexdigest(),
        'resolverHardened': harden_resolver, 'bootValidationTimer': BOOT_TIMER.name,
        'runtimeTimerEnabledByExplicitPlanOnly': True, 'newSudoPrivileges': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harden-resolver', action='store_true')
    install(parser.parse_args().harden_resolver)
