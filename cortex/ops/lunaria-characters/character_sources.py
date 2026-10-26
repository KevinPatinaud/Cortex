#!/usr/bin/env python3
"""Read-only Git source refresh and evidenced character inventory for Lunaria.

This tool never edits character cards, source repositories, schedules or agents.
Its inventory is evidence for editorial review, not an automatic deletion list.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import unicodedata


AUTHORING = "HISTOIRE DE LUNARIA/Cinematiques studio/lunaria.game.json"
STORY = "HISTOIRE DE LUNARIA/LUNARIA_HISTOIRE_COMPLETE_VERSION_DEVELOPPEE.md"
RUNTIME = "game/content/design/game_content.json"


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def normalized(value):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")


def unique_index(items, label):
    if not isinstance(items, list):
        raise ValueError(label + ": liste absente")
    result = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
            raise ValueError(label + ": identifiant absent")
        if item["id"] in result:
            raise ValueError(label + ": identifiant dupliqué " + item["id"])
        result[item["id"]] = item
    return result


def cinematic_references(value):
    found = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "cinematicId" and isinstance(child, str):
                found.add(child)
            else:
                found.update(cinematic_references(child))
    elif isinstance(value, list):
        for child in value:
            found.update(cinematic_references(child))
    return found


def scan_project(document):
    if not isinstance(document, dict) or not document.get("id"):
        raise ValueError("Projet d'auteur invalide")
    campaign = document.get("campaign")
    if not isinstance(campaign, dict) or not isinstance(campaign.get("steps"), list):
        raise ValueError("Parcours de campagne absent")
    films = unique_index(document.get("cinematics"), "Films complets")
    references = unique_index(campaign.get("cinematics"), "Références de films")
    levels = unique_index(document.get("levels"), "Niveaux")
    reachable = set()
    active_steps = []
    ended = False
    for step in campaign["steps"]:
        if not isinstance(step, dict):
            raise ValueError("Étape de campagne invalide")
        if step.get("kind") == "end":
            ended = True
            break
        active_steps.append(step.get("id"))
        if step.get("kind") == "cinematic":
            reference = step.get("cinematicId")
            if not isinstance(reference, str):
                raise ValueError("Étape sans référence de film")
            reachable.add(reference)
        elif step.get("kind") == "level":
            level = levels.get(step.get("levelId"))
            if level is None:
                raise ValueError("Niveau de campagne introuvable")
            reachable.update(cinematic_references(level))
        else:
            raise ValueError("Type d'étape inconnu : " + str(step.get("kind")))
    if not active_steps:
        raise ValueError("Campagne vide : aucune suppression ne peut être déduite")
    characters = {}
    film_evidence = []
    for reference in sorted(reachable):
        definition = references.get(reference)
        if definition is None:
            raise ValueError("Référence de film introuvable : " + reference)
        film = films.get(definition.get("documentId", reference))
        if film is None or not isinstance(film.get("shots"), list) or not film["shots"]:
            raise ValueError("Film complet introuvable ou vide : " + reference)
        film_evidence.append({"referenceId": reference, "documentId": film["id"], "title": film.get("title")})
        for shot in film["shots"]:
            if not isinstance(shot.get("actors", []), list) or not isinstance(shot.get("bubbles", []), list):
                raise ValueError("Composition de plan invalide")
            for actor in shot.get("actors", []):
                asset = actor.get("asset", "")
                match = re.match(r"^library://02_characters/([^/]+)/", asset)
                if not match or actor.get("role") in ["prop", "enemy"]:
                    continue
                key = normalized(match[1])
                entry = characters.setdefault(key, {"id": key, "assetFolder": match[1], "appearances": [], "assets": []})
                if asset not in entry["assets"]:
                    entry["assets"].append(asset)
                entry["appearances"].append({
                    "filmId": film["id"], "filmTitle": film.get("title"), "shotId": shot.get("id"),
                    "actorId": actor.get("id"), "actorName": actor.get("name"), "asset": asset,
                    "opacity": actor.get("opacity", 1),
                    "dialogue": [{"text": bubble.get("text", ""), "speakerId": bubble.get("speakerId"),
                                  "attributedToActor": bool(bubble.get("speakerId")) and bubble.get("speakerId") == actor.get("id")}
                                 for bubble in shot.get("bubbles", [])]
                })
    if not film_evidence or not characters:
        raise ValueError("Aucun personnage vérifié : examiner la source, ne pas vider le site")
    return {"schemaVersion": 1, "projectId": document["id"], "complete": True,
            "activeStepIds": active_steps, "endMarkerApplied": ended, "films": film_evidence,
            "characters": list(characters.values()),
            "limits": ["Candidats identifiés par médias de personnages et compositions actives ; vérifier leur identité narrative.",
                       "Les mentions hors champ, personnages dans des décors et usages de combat demandent une vérification complémentaire.",
                       "Un dialogue sans speakerId est un contexte, jamais une citation attribuée automatiquement.",
                       "L'inventaire ne constitue pas une autorisation automatique de supprimer une fiche."]}


def git(command, repository=None, key=None, binary=False):
    environment = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    if key:
        import shlex
        environment["GIT_SSH_COMMAND"] = "ssh -i " + shlex.quote(str(key)) + " -o IdentitiesOnly=yes -o BatchMode=yes"
    args = ["git"] + (["-C", str(repository)] if repository else []) + command
    result = subprocess.run(args, env=environment, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError("Lecture Git impossible : " + result.stderr.decode(errors="replace")[-1200:])
    return result.stdout if binary else result.stdout.decode("utf-8")


def refresh(project):
    private = Path(project) / ".cortex/characters"
    configuration = read_json(private / "source-config.json")
    mirror = private / "source.git"
    key = configuration["sshKey"]
    try:
        if not mirror.exists():
            git(["init", "--bare", str(mirror)])
            git(["remote", "add", "origin", configuration["repository"]], mirror)
        git(["config", "remote.origin.promisor", "true"], mirror)
        git(["config", "remote.origin.partialclonefilter", "blob:none"], mirror)
        git(["fetch", "--filter=blob:none", "--depth=1", "--no-tags", "origin", "refs/heads/" + configuration["branch"]], mirror, key)
        revision = git(["rev-parse", "FETCH_HEAD"], mirror).strip()
        authoring = git(["show", revision + ":" + AUTHORING], mirror, key)
        document = json.loads(authoring)
        upstream_inventory = scan_project(document)
        baseline = read_json(private / "baseline/manifest.json") if (private / "baseline/manifest.json").exists() else None
        using_baseline = bool(baseline and revision in baseline.get("supersededUpstreamCommits", []))
        destination = private / "upstream" / revision
        destination.mkdir(parents=True, exist_ok=True)
        atomic_json(destination / "authoring.json", document)
        for source, output in [(STORY, "story.md"), (RUNTIME, "runtime.json")]:
            value = git(["show", revision + ":" + source], mirror, key)
            if output.endswith(".json"):
                json.loads(value)
            (destination / output).write_text(value, encoding="utf-8")
        selected = private / "baseline" if using_baseline else destination
        if using_baseline:
            for name, evidence in baseline.get("files", {}).items():
                if Path(name).name != name or hashlib.sha256((selected / name).read_bytes()).hexdigest() != evidence["sha256"]:
                    raise ValueError("Empreinte de la référence initiale incorrecte : " + name)
        inventory = scan_project(read_json(selected / "authoring.json"))
        inventory.update({"refreshedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                          "upstreamRevision": revision, "sourceDirectory": str(selected),
                          "sourceMode": "verified-local-baseline" if using_baseline else "github",
                          "upstreamOlderThanBaseline": using_baseline,
                          "deletionAllowedFromUpstream": not using_baseline,
                          "upstreamCharacterIds": [c["id"] for c in upstream_inventory["characters"]]})
        atomic_json(private / "inventory.json", inventory)
        atomic_json(private / "current-source.json", {key: inventory[key] for key in ["refreshedAt", "sourceDirectory", "sourceMode", "upstreamRevision", "upstreamOlderThanBaseline", "deletionAllowedFromUpstream"]})
        atomic_json(private / "last-refresh.json", {"status": "ok", "revision": revision})
        return {"status": "ok", "sourceMode": inventory["sourceMode"], "upstreamRevision": revision,
                "characters": [c["id"] for c in inventory["characters"]], "inventory": str(private / "inventory.json"),
                "sourceDirectory": str(selected), "upstreamOlderThanBaseline": using_baseline}
    except Exception as error:
        atomic_json(private / "last-refresh.json", {"status": "failed", "error": str(error),
                    "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "preserveExistingCards": True})
        raise


def export_asset(project, asset, destination):
    relative = PurePosixPath(asset.removeprefix("library://"))
    if not asset.startswith("library://") or relative.is_absolute() or ".." in relative.parts or "\\" in str(relative):
        raise ValueError("Référence de média non autorisée")
    private = Path(project) / ".cortex/characters"
    current = read_json(private / "current-source.json")
    configuration = read_json(private / "source-config.json")
    if current["sourceMode"] == "verified-local-baseline":
        source = private / "baseline/media" / str(relative)
        if not source.is_file():
            raise ValueError("Média absent du paquet initial ; ne pas substituer un autre personnage")
        data = source.read_bytes()
        manifest = read_json(private / "baseline/manifest.json")
        evidence = next((item for item in manifest.get("media", []) if item["asset"] == asset), None)
        if not evidence or hashlib.sha256(data).hexdigest() != evidence["sha256"]:
            raise ValueError("Empreinte du média initial incorrecte")
    else:
        data = git(["show", current["upstreamRevision"] + ":LunariaArtLibrary/" + str(relative)],
                   private / "source.git", configuration["sshKey"], binary=True)
    if len(data) > 50 * 1024 * 1024:
        raise ValueError("Média trop volumineux")
    output = Path(destination)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=output.name + ".", dir=output.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"path": str(output), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    scan = subparsers.add_parser("scan")
    scan.add_argument("document")
    update = subparsers.add_parser("refresh")
    update.add_argument("--project", required=True)
    asset = subparsers.add_parser("asset")
    asset.add_argument("--project", required=True)
    asset.add_argument("--reference", required=True)
    asset.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.command == "scan":
        result = scan_project(read_json(args.document))
    elif args.command == "refresh":
        result = refresh(args.project)
    else:
        result = export_asset(args.project, args.reference, args.output)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
