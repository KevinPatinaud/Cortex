import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from character_sources import scan_project, refresh, export_asset


def fixture():
    def film(identity, folder):
        return {"id": identity, "title": identity, "shots": [{"id": "shot", "actors": [
            {"id": "actor", "asset": "library://02_characters/" + folder + "/portrait.png"}],
            "bubbles": [{"text": "Je veille.", "speakerId": None}]}]}
    return {"id": "game", "levels": [{"id": "level"}], "campaign": {
        "steps": [{"id": "a", "kind": "cinematic", "cinematicId": "first"}, {"id": "b", "kind": "end"},
                  {"id": "c", "kind": "cinematic", "cinematicId": "future"}],
        "cinematics": [{"id": "first", "documentId": "film1"}, {"id": "future", "documentId": "film2"}]},
        "cinematics": [film("film1", "Rose"), film("film2", "lierre"), film("unused", "fougere")]}


class SourcesTest(unittest.TestCase):
    def test_only_reachable_films_before_end(self):
        result = scan_project(fixture())
        self.assertEqual([c["id"] for c in result["characters"]], ["rose"])
        self.assertTrue(result["endMarkerApplied"])

    def test_case_variants_and_multiple_scenes_keep_one_character(self):
        document = fixture()
        actor = copy.deepcopy(document["cinematics"][0]["shots"][0]["actors"][0])
        actor["asset"] = "library://02_characters/rose/different.png"
        document["cinematics"][0]["shots"][0]["actors"].append(actor)
        self.assertEqual(len(scan_project(document)["characters"]), 1)
        document["cinematics"][0]["shots"][0]["actors"].pop()
        self.assertEqual(len(scan_project(document)["characters"]), 1)

    def test_missing_film_does_not_become_empty_inventory(self):
        document = fixture()
        document["cinematics"] = []
        with self.assertRaises(ValueError):
            scan_project(document)

    def test_unknown_step_or_empty_campaign_fails_closed(self):
        for steps in [[], [{"kind": "unknown"}]]:
            document = fixture()
            document["campaign"]["steps"] = steps
            with self.assertRaises(ValueError):
                scan_project(document)

    def test_unattributed_dialogue_stays_unattributed(self):
        dialogue = scan_project(fixture())["characters"][0]["appearances"][0]["dialogue"][0]
        self.assertFalse(dialogue["attributedToActor"])

    def test_level_trigger_includes_reachable_cinematic(self):
        document = fixture()
        document["campaign"]["steps"].insert(0, {"id": "level-step", "kind": "level", "levelId": "level"})
        document["levels"][0]["events"] = [{"cinematicId": "future"}]
        self.assertEqual({c["id"] for c in scan_project(document)["characters"]}, {"rose", "lierre"})

    def test_props_and_unused_libraries_are_not_characters(self):
        document = fixture()
        document["cinematics"][0]["shots"][0]["actors"].append(
            {"id": "prop", "role": "prop", "asset": "library://02_characters/unused/portrait.png"})
        self.assertEqual([c["id"] for c in scan_project(document)["characters"]], ["rose"])

    def test_fetch_failure_preserves_previous_inventory(self):
        with tempfile.TemporaryDirectory() as folder:
            private = Path(folder) / ".cortex/characters"
            private.mkdir(parents=True)
            (private / "source-config.json").write_text(json.dumps({"repository": "test", "branch": "main", "sshKey": "key"}))
            inventory = private / "inventory.json"
            inventory.write_text('{"preserve":"this"}')
            with patch("character_sources.git", side_effect=RuntimeError("unavailable")):
                with self.assertRaises(RuntimeError):
                    refresh(folder)
            self.assertEqual(json.loads(inventory.read_text()), {"preserve": "this"})
            self.assertTrue(json.loads((private / "last-refresh.json").read_text())["preserveExistingCards"])

    def test_asset_traversal_is_refused(self):
        with self.assertRaises(ValueError):
            export_asset("unused", "library://../../secret", "unused")

    def test_duplicate_film_identity_fails(self):
        document = fixture()
        document["cinematics"].append(document["cinematics"][0])
        with self.assertRaises(ValueError):
            scan_project(document)

    def test_older_upstream_uses_initial_canon_and_blocks_upstream_deletion(self):
        with tempfile.TemporaryDirectory() as folder:
            private = Path(folder) / ".cortex/characters"
            baseline = private / "baseline"
            baseline.mkdir(parents=True)
            local = fixture()
            local["cinematics"][0]["shots"][0]["actors"][0]["asset"] = "library://02_characters/lierre/master.png"
            (baseline / "authoring.json").write_text(json.dumps(local))
            (baseline / "manifest.json").write_text(json.dumps({"supersededUpstreamCommits": ["old"]}))
            (private / "source-config.json").write_text(json.dumps({"repository": "test", "branch": "main", "sshKey": "key"}))
            def fake_git(command, *args, **kwargs):
                if command[0] == 'rev-parse':
                    return 'old\n'
                if command[0] == 'show':
                    if command[1].endswith('lunaria.game.json'):
                        return json.dumps(fixture())
                    if command[1].endswith('.json'):
                        return '{}'
                    return 'Story'
                return ''
            with patch('character_sources.git', side_effect=fake_git):
                result = refresh(folder)
            self.assertEqual(result['characters'], ['lierre'])
            self.assertEqual(result['sourceMode'], 'verified-local-baseline')
            self.assertFalse(json.loads((private / 'inventory.json').read_text())['deletionAllowedFromUpstream'])


if __name__ == "__main__":
    unittest.main()
