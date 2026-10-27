#!/usr/bin/env python3
"""Unprivileged access to infrastructure evidence; no healthy-site startup gate."""
import argparse
import datetime
import json
from pathlib import Path
import subprocess


def status():
    snapshot = json.loads(Path('/var/lib/lunaria-infra/current.json').read_text())
    checked = datetime.datetime.fromisoformat(snapshot['checkedAt'])
    snapshot['ageSeconds'] = round((datetime.datetime.now(datetime.timezone.utc) - checked).total_seconds())
    snapshot['observationStale'] = snapshot['ageSeconds'] > 15 * 60
    return snapshot


def preflight():
    result = subprocess.run(['sudo', '-n', '/usr/local/sbin/lunaria-infra', 'version'], capture_output=True, text=True, timeout=8, check=True)
    snapshot = status()
    return {'status': 'ready', 'helperVersion': result.stdout.strip(), 'lastObservation': snapshot['checkedAt'],
            'observationStale': snapshot['observationStale'], 'healthProblemsDoNotPreventAgentStartup': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['preflight', 'status'])
    args = parser.parse_args()
    print(json.dumps(preflight() if args.command == 'preflight' else status(), ensure_ascii=False))
