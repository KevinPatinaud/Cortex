#!/usr/bin/env python3
"""Install the passive system probe and root-owned repair tool; no new sudo rights."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import pwd
import shutil
import subprocess

LIBRARY = Path('/usr/local/lib/lunaria-infra')
HELPER = Path('/usr/local/sbin/lunaria-infra')
STATE = Path('/var/lib/lunaria-infra')
UNIT = Path('/etc/systemd/system/lunaria-infra-probe.service')
TIMER = Path('/etc/systemd/system/lunaria-infra-probe.timer')

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


def install():
    if os.geteuid() != 0:
        raise PermissionError('Installer avec sudo')
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
             UNIT: (SERVICE_TEXT, 0o644), TIMER: (TIMER_TEXT, 0o644)}
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
    subprocess.run(['systemd-analyze', 'verify', str(UNIT), str(TIMER)], check=True, capture_output=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', TIMER.name], check=True, capture_output=True)
    subprocess.run(['systemctl', 'start', UNIT.name], check=True, timeout=130)
    print(json.dumps({'helper': str(HELPER), 'passiveProbeTimer': TIMER.name, 'probeInterval': '5min',
        'changed': changed, 'rootToolSha256': hashlib.sha256((LIBRARY / 'infra_health.py').read_bytes()).hexdigest(),
        'newSudoPrivileges': False}))


if __name__ == '__main__':
    install()
