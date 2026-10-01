"""Local authenticated Cortex API. Existing password stays in memory, never in output."""
import json, pathlib, urllib.request, urllib.error, sys

BASE = 'http://127.0.0.1:3000'

def password_from_server():
    for folder in pathlib.Path('/proc').iterdir():
        if not folder.name.isdigit():
            continue
        try:
            if b'src/back/infrastructure/web/controller/server.ts' not in (folder / 'cmdline').read_bytes():
                continue
            values = dict(part.split(b'=', 1) for part in (folder / 'environ').read_bytes().split(b'\0') if b'=' in part)
            password = values.get(b'CORTEX_PASSWORD', b'').decode()
            if password:
                return password
        except (PermissionError, FileNotFoundError, ProcessLookupError):
            continue
    raise RuntimeError('Identifiant Cortex existant indisponible; aucun secret affiché.')

class CortexAPI:
    def __init__(self):
        password = password_from_server()
        request = urllib.request.Request(BASE + '/api/auth/login', data=json.dumps({'password': password}).encode(),
                                        headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=20) as response:
            self.cookie = response.headers.get('Set-Cookie').split(';', 1)[0]

    def call(self, method, path, body=None, timeout=900):
        if not path.startswith('/api/'):
            raise ValueError('Seuls les chemins /api/ locaux sont autorisés.')
        request = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                        headers={'Content-Type': 'application/json', 'Cookie': self.cookie}, method=method.upper())
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'Cortex HTTP {error.code}: {error.read().decode()[:1000]}') from None

if __name__ == '__main__':
    try:
        if len(sys.argv) not in (3, 4) or sys.argv[1].upper() not in ('GET', 'POST', 'PUT'):
            raise ValueError('Usage : python3 cortex_api.py GET|POST|PUT /api/chemin [corps.json]')
        body = json.loads(pathlib.Path(sys.argv[3]).read_text()) if len(sys.argv) == 4 else None
        print(json.dumps(CortexAPI().call(sys.argv[1], sys.argv[2], body), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
