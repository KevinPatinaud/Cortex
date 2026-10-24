#!/usr/bin/env python3
"""Seed quality profiles through the authenticated running API; preview unless --apply.

Only named LunariaWebsite/Poulailler projects are selected. Existing profiles,
agent definitions, schedules, quotas and business data are preserved.
"""
import argparse
import datetime
import http.cookies
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--preset", choices=["lunaria-website", "poulailler"], required=True)
parser.add_argument("--base-url", default="http://127.0.0.1:3000")
parser.add_argument("--env-file", default=str(pathlib.Path.home() / ".config/cortex/server.env"))
parser.add_argument("--apply", action="store_true")
args = parser.parse_args()
application = pathlib.Path.cwd()
configuration_file = application / "config.json"
configuration = json.loads(configuration_file.read_text())

password = os.environ.get("CORTEX_PASSWORD")
environment_file = pathlib.Path(args.env_file)
if not password and environment_file.is_file():
    for line in environment_file.read_text().splitlines():
        fields = shlex.split(line, comments=True)
        for field in fields:
            if field.startswith("CORTEX_PASSWORD="):
                password = field.split("=", 1)[1]
if not password:
    # Read only our own service's existing credential, without displaying it.
    try:
        pid = subprocess.check_output(["systemctl", "--user", "show", "cortex.service", "-p", "MainPID", "--value"], text=True).strip()
        env = dict(value.split("=", 1) for value in (pathlib.Path("/proc") / pid / "environ").read_text().split("\0") if "=" in value)
        password = env.get("CORTEX_PASSWORD")
        argv = (pathlib.Path("/proc") / pid / "cmdline").read_text().split("\0")
        if not password and "--password" in argv:
            password = argv[argv.index("--password") + 1]
        if not password:
            password = next((value.split("=", 1)[1] for value in argv if value.startswith("--password=")), None)
    except (OSError, subprocess.SubprocessError, ValueError):
        pass

cookie = ""
if password:
    request = urllib.request.Request(args.base_url + "/api/auth/login", data=json.dumps({"password": password}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        parsed = http.cookies.SimpleCookie()
        for header in response.headers.get_all("Set-Cookie", []):
            parsed.load(header)
        cookie = "; ".join(key + "=" + value.value for key, value in parsed.items())

def api(route, value=None):
    headers = {"Content-Type": "application/json", "Cookie": cookie}
    request = urllib.request.Request(args.base_url + route, headers=headers,
        data=json.dumps(value).encode() if value is not None else None, method="PUT" if value is not None else "GET")
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)

projects = api("/api/projects")["projects"]
names = {"Lunaria Clean", "Renforcement valeur percue", "Évolution fonctionnelle", "Esthétique et UX-UI", "Responsive testing"}
selected = [p for p in projects if (pathlib.Path(p["directoryPath"]).name in names if args.preset == "lunaria-website"
    else pathlib.Path(p["directoryPath"]).name.casefold().startswith("ai poulailler -"))]
if not selected:
    raise SystemExit("No matching registered project; nothing changed.")
workspace = pathlib.Path("/home/kevin/repos/LunariaWebsite" if args.preset == "lunaria-website" else "/home/kevin/apps/ai-poulailler/source")
if not workspace.is_dir():
    raise SystemExit("Expected source repository missing; nothing changed.")
backup = None
for project in selected:
    name = pathlib.Path(project["directoryPath"]).name
    if project["id"] in configuration.get("executionPolicies", {}):
        print(json.dumps({"project": name, "status": "existing-profile-preserved"}, ensure_ascii=False))
        continue
    settings = api("/api/agents/projects/" + project["id"] + "/execution-policy")
    policy = settings["policy"]
    policy.update(workspaceDirectory=str(workspace), defaultModel="gpt-6.1-sol", defaultReasoningEffort="xhigh",
        delegation="bounded", resumeUnfinished=True)
    if args.preset == "lunaria-website":
        policy["acceptanceCriteria"] = [
            "Le parcours concerné est utilisable et vérifié sur la version publiée.",
            "Les contrôles effectués, leurs preuves et leurs limites sont précisés.",
            "La livraison respecte les données existantes et les règles Git du projet."]
        policy["preflightChecks"] = [{"label": "Git disponible", "command": "git", "args": ["--version"]},
            {"label": "Navigateur Lunaria disponible", "command": "node", "args": ["--input-type=module", "-e",
                "const {launchBrowser}=await import('./tools/lunaria-browser.mjs'); const b=await launchBrowser(); await b.close();"]}]
        policy["checks"] = [{"label": "Contrôles du dépôt LunariaWebsite", "command": "npm", "args": ["run", "check"]},
            {"label": "Parcours publics sur trois formats", "command": "node", "args": ["tools/browser-smoke.mjs", "https://savelunaria.com", "work/cortex-verification"]}]
    else:
        policy["acceptanceCriteria"] = [
            "Le résultat utile est observé et vérifié sur le poulailler publié, ou l'absence de modification est justifiée.",
            "Les habitants, les œufs, l'histoire et le temps réel du monde sont préservés.",
            "Les preuves des contrôles et les limites de la validation sont explicites."]
        policy["preflightChecks"] = [{"label": "PHP disponible", "command": "php", "args": ["--version"]},
            {"label": "Python disponible", "command": "python3", "args": ["--version"]}]
        policy["checks"] = [{"label": "Validation indépendante du poulailler", "command": "python3", "args": ["server/publish.py", "--check"]}]
    if args.apply:
        if backup is None:
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup = application / "data/backups" / (stamp + "-execution-quality")
            backup.mkdir(parents=True, mode=0o700)
            shutil.copy2(configuration_file, backup / "config.json")
            os.chmod(backup / "config.json", 0o600)
        api("/api/agents/projects/" + project["id"] + "/execution-policy", policy)
        verified = api("/api/agents/projects/" + project["id"] + "/execution-policy")
        assert verified["policy"] == policy
    print(json.dumps({"project": name, "status": "applied" if args.apply else "preview", "policy": policy}, ensure_ascii=False))
