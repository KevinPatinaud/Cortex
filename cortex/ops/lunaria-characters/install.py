#!/usr/bin/env python3
"""Install the authorized characters agent through the running Cortex API.

Preserves existing project definitions, schedules, quota thresholds and policies.
Requires a prepared private baseline archive and the dedicated read-only Git key.
"""
import argparse
import copy
import datetime
import hashlib
import http.cookies
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tarfile
import urllib.request

from character_sources import atomic_json, read_json, refresh, scan_project

NAME = "Personnages et habitants de Lunaria"
ROOT = Path('/home/kevin/Cortex/cortex')
WORKSPACE = '/home/kevin/repos/LunariaWebsite'
KEY = '/home/kevin/.ssh/lunaria-characters-readonly'


def connection(base):
    password = os.environ.get('CORTEX_PASSWORD')
    environment_file = Path('/home/kevin/.config/cortex/server.env')
    if not password and environment_file.is_file():
        for line in environment_file.read_text().splitlines():
            for field in shlex.split(line, comments=True):
                if field.startswith('CORTEX_PASSWORD='):
                    password = field.split('=', 1)[1]
    if not password:
        pid = subprocess.check_output(['systemctl', '--user', 'show', 'cortex.service', '-p', 'MainPID', '--value'], text=True).strip()
        environment = dict(field.split('=', 1) for field in (Path('/proc') / pid / 'environ').read_text().split('\0') if '=' in field)
        password = environment.get('CORTEX_PASSWORD')
        argv = (Path('/proc') / pid / 'cmdline').read_text().split('\0')
        if not password and '--password' in argv:
            password = argv[argv.index('--password') + 1]
        if not password:
            password = next((field.split('=', 1)[1] for field in argv if field.startswith('--password=')), None)
    if not password:
        raise RuntimeError('Identifiant Cortex indisponible ; aucune authentification affichée')
    request = urllib.request.Request(base + '/api/auth/login', data=json.dumps({'password': password}).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=20) as response:
        cookies = http.cookies.SimpleCookie()
        for header in response.headers.get_all('Set-Cookie', []):
            cookies.load(header)
        cookie = '; '.join(key + '=' + value.value for key, value in cookies.items())

    def api(route, value=None, method=None):
        request = urllib.request.Request(base + route, data=json.dumps(value).encode() if value is not None else None,
            headers={'Content-Type': 'application/json', 'Cookie': cookie}, method=method or ('PUT' if value is not None else 'GET'))
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError('API Cortex ' + str(error.code) + ' ' + route + ': ' + error.read().decode()[:1200]) from None
    return api


def definition_hashes(projects):
    result = {}
    for project in projects:
        directory = Path(project['directoryPath'])
        for file in [directory / 'AGENTS.md', *(directory / '.codex/agents').glob('*.toml')]:
            if file.is_file():
                result[str(file)] = hashlib.sha256(file.read_bytes()).hexdigest()
    return result


def shared_instructions():
    journal = ROOT / 'projects/Journal et actualités de Lunaria/AGENTS.md'
    text = journal.read_text()
    blocks = []
    for marker in ['LUNARIA_GAME_ASSETS', 'LUNARIA_GITHUB_MAIN', 'LUNARIA_AUTONOMY', 'LUNARIA_IMMERSIVE_REFERENCE']:
        match = re.search(r'<!-- ' + marker + r'_BEGIN -->.*?<!-- ' + marker + r'_END -->', text, re.S)
        if not match:
            raise ValueError('Référence commune introuvable : ' + marker)
        blocks.append(match.group())
    return '# ' + NAME + '\n\nResponsable des fiches de personnages, du panneau Les habitants et de l’herbier. Passage quotidien à 20 h Europe/Paris. Appliquer la mission individuelle et ces références communes.\n\n' + '\n\n'.join(blocks) + '\n'


def install(archive, base):
    api = connection(base)
    before = read_json(ROOT / 'config.json')
    original_projects = [p for p in before['projects'] if Path(p['directoryPath']).name != NAME]
    original_hashes = definition_hashes(original_projects)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = ROOT / 'data/backups' / (stamp + '-characters-agent')
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(ROOT / 'config.json', backup / 'config.json')
    (backup / 'config.json').chmod(0o600)
    found = [p for p in api('/api/projects')['projects'] if Path(p['directoryPath']).name == NAME]
    if len(found) > 1:
        raise ValueError('Plusieurs projets portent ce nom ; aucune duplication automatique')
    instructions = shared_instructions()
    project = found[0] if found else api('/api/projects/create', {'parentDirectory': str(ROOT / 'projects'),
        'name': NAME, 'engine': 'codex', 'generationMode': 'empty', 'instructions': instructions}, 'POST')['project']
    project_id = project['id']
    directory = Path(project['directoryPath'])
    if found:
        api('/api/agents/projects/' + project_id + '/workflow/schedule', {'cron': '0 20 * * *', 'crons': ['0 20 * * *'],
            'timezone': 'Europe/Paris', 'enabled': False, 'parameterValues': {}})
    prompt = (Path(__file__).parent / 'agent-prompt.md').read_text().replace('__PROJECT_ROOT__', str(directory))
    api('/api/agents/projects/' + project_id, {'name': NAME, 'engine': 'codex', 'instructions': instructions,
        'agents': [{'name': NAME, 'description': 'Enrichit et synchronise les fiches des personnages réellement utilisés dans Lunaria, avec sources narratives, médias officiels et validation publiée.',
                    'prompt': prompt, 'model': 'gpt-6.1-sol', 'reasoningEffort': 'xhigh'}]})
    api('/api/agents/projects/' + project_id + '/workflow/schedule', {'cron': '0 20 * * *', 'crons': ['0 20 * * *'],
        'timezone': 'Europe/Paris', 'enabled': False, 'parameterValues': {}})
    tools = directory / 'tools'
    tools.mkdir(exist_ok=True)
    for name in ['character_sources.py', 'test_character_sources.py']:
        shutil.copy2(Path(__file__).parent / name, tools / name)
    private = directory / '.cortex/characters'
    private.mkdir(parents=True, mode=0o700, exist_ok=True)
    if not (private / 'baseline/manifest.json').exists():
        with tarfile.open(archive, 'r:gz') as package:
            for member in package.getmembers():
                target = (private / member.name).resolve()
                if not target.is_relative_to(private.resolve()) or not (member.name.startswith('baseline/') or member.name == 'baseline') or not (member.isfile() or member.isdir()):
                    raise ValueError('Chemin non autorisé dans la référence initiale')
            package.extractall(private, filter='data')
    scan_project(read_json(private / 'baseline/authoring.json'))
    atomic_json(private / 'source-config.json', {'schemaVersion': 1, 'repository': 'ssh://git@github.com/KevinPatinaud/Lunaria.git',
        'branch': 'refactor/clean-architecture', 'sshKey': KEY})
    source = refresh(directory)
    subprocess.run(['python3', '-m', 'unittest', '-v', 'test_character_sources.py'], cwd=tools, check=True)
    policy = api('/api/agents/projects/' + project_id + '/execution-policy')['policy']
    policy.update(resultMode='separate', interpretationModel='', interpretationReasoningEffort='low',
        workspaceDirectory=WORKSPACE, defaultModel='gpt-6.1-sol', defaultReasoningEffort='xhigh', delegation='none', resumeUnfinished=True,
        acceptanceCriteria=[
            'La synchronisation ou l’amélioration complète des fiches retenues est publiée et vérifiée, ou l’absence de modification est motivée.',
            'Les personnages, faits, capacités et médias sont étayés par les sources actuelles ; archives, brouillons, mentions et réalité jouable sont distingués.',
            'Toute suppression est justifiée par une lecture complète et réussie, l’absence de tous les usages pertinents et la résolution des renommages ; une erreur d’accès préserve les fiches.',
            'Le panneau Les habitants et l’herbier utilisent un catalogue cohérent ; navigation, portraits, textes, liens et formats utiles sont réellement examinés.',
            'Les contrôles pertinents, build, commit main, déploiement, production et push vérifié sont documentés ; les données et les autres missions sont préservées.',
            'L’état durable distingue livraison terminée, blocage réel et idées futures ; absence de visiteurs ou de conversion mesurée n’est pas un reste de livraison.'
        ], preflightChecks=[{'label': 'Sources narratives accessibles et inventaire validé', 'command': 'python3',
            'args': [str(tools / 'character_sources.py'), 'refresh', '--project', str(directory)]},
            {'label': 'Navigateur Lunaria disponible', 'command': 'node', 'args': ['--input-type=module', '-e',
             "const {launchBrowser}=await import('./tools/lunaria-browser.mjs'); const b=await launchBrowser(); await b.close();"]}],
        checks=[{'label': 'Contrôles du site', 'command': 'npm', 'args': ['run', 'check']},
                {'label': 'Parcours publics publiés', 'command': 'node', 'args': ['tools/browser-smoke.mjs', 'https://savelunaria.com', 'work/personnages/cortex-verification']}])
    api('/api/agents/projects/' + project_id + '/execution-policy', policy)
    # There is no workspace-registration endpoint. Add only this new identity,
    # atomically after API writes; reject a concurrent configuration change.
    current = read_json(ROOT / 'config.json')
    changed = copy.deepcopy(current)
    groups = [g for g in changed.get('executionWorkspaces', []) if g['directory'] == WORKSPACE]
    if len(groups) != 1:
        raise ValueError('Groupe partagé Lunaria ambigu')
    if project_id not in groups[0]['projectIds']:
        groups[0]['projectIds'].append(project_id)
    if read_json(ROOT / 'config.json') != current:
        raise RuntimeError('Configuration modifiée simultanément ; relancer sans écraser')
    atomic_json(ROOT / 'config.json', changed)
    loaded = api('/api/agents/projects/' + project_id)
    if len(loaded.get('agents', [])) != 1:
        raise ValueError('Le projet doit contenir exactement un agent')
    preview = api('/api/agents/projects/' + project_id + '/workflow/schedule/preview',
        {'cron': '0 20 * * *', 'timezone': 'Europe/Paris'}, 'POST')
    after = read_json(ROOT / 'config.json')
    if before.get('codexQuota') != after.get('codexQuota') or original_hashes != definition_hashes(original_projects):
        raise RuntimeError('Une configuration existante a changé ; ne pas activer le créneau')
    for old in original_projects:
        for section in ['workflowSchedules', 'executionPolicies']:
            if before.get(section, {}).get(old['id']) != after.get(section, {}).get(old['id']):
                raise RuntimeError('Un paramètre existant a changé ; ne pas activer le créneau')
    schedule = api('/api/agents/projects/' + project_id + '/workflow/schedule',
        {'cron': '0 20 * * *', 'crons': ['0 20 * * *'], 'timezone': 'Europe/Paris', 'enabled': True, 'parameterValues': {}})
    result = {'name': NAME, 'projectId': project_id, 'directory': str(directory), 'agentCount': len(loaded['agents']),
        'source': source, 'schedule': schedule, 'schedulePreview': preview, 'existingDefinitionsPreserved': True,
        'existingSchedulesAndQuotasPreserved': True, 'sharedWorkspace': groups[0]['id'], 'backup': str(backup)}
    atomic_json(private / 'installation.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-archive', required=True)
    parser.add_argument('--base-url', default='http://127.0.0.1:3000')
    args = parser.parse_args()
    print(json.dumps(install(args.baseline_archive, args.base_url), ensure_ascii=False))
