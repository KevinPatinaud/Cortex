"""Install/update the Cortex project through its live API, preserving its identity."""
import json, pathlib, sys
from cortex_api import CortexAPI

NAME = 'Surveillance et réparation du journal'
ROOT = pathlib.Path('/home/kevin/Cortex/cortex')
SOURCE = pathlib.Path(__file__).resolve().parent

def install():
    api = CortexAPI()
    projects = api.call('GET', '/api/projects')['projects']
    matches = [p for p in projects if pathlib.Path(p['directoryPath']).name == NAME]
    if len(matches) > 1:
        raise RuntimeError('Plusieurs projets de surveillance existent : aucune duplication créée.')
    if matches:
        project = matches[0]
    else:
        project = api.call('POST', '/api/projects/create', {
            'name': NAME, 'engine': 'codex', 'generationMode': 'empty',
            'parentDirectory': str(ROOT / 'projects'),
            'instructions': (SOURCE / 'template/AGENTS.md').read_text()
        })['project']
    api.call('PUT', f"/api/agents/projects/{project['id']}", {
        'name': NAME, 'engine': 'codex',
        'instructions': (SOURCE / 'template/AGENTS.md').read_text(),
        'agents': [{
            'name': 'Surveillant et réparateur du journal',
            'description': 'Vérifie la publication du jour, récupère une édition manquante et corrige Cortex avec tests et push GitHub.',
            'prompt': (SOURCE / 'template/agent-prompt.md').read_text(),
            'model': 'gpt-5.6-sol', 'reasoningEffort': 'medium'
        }]
    })
    schedule = api.call('PUT', f"/api/agents/projects/{project['id']}/workflow/schedule", {
        'cron': '30 8 * * *', 'timezone': 'Europe/Paris', 'enabled': True, 'parameterValues': {}
    })
    state = pathlib.Path(project['directoryPath']) / '.cortex/journal-watch'
    state.mkdir(parents=True, exist_ok=True)
    (state / 'installation.json').write_text(json.dumps({'project': project, 'schedule': schedule}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'project': project, 'schedule': schedule}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    try:
        install()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
