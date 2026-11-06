import contextlib
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import infra_health as infra
import infra_maintenance as maintenance
import install_system


class MaintenanceTest(unittest.TestCase):
    def test_unreconciled_package_transaction_is_preserved(self):
        for status in ['prepared', 'applying', 'failed']:
            with self.subTest(status=status), patch.object(infra, 'read_state', return_value={'status': status}), \
                 patch.object(maintenance, 'inventory') as inventory, patch.object(maintenance, 'apt') as apt:
                with self.assertRaisesRegex(RuntimeError, 'Réconcilier'):
                    maintenance.upgrade_packages(['tzdata=2026f-0+deb13u1'])
                inventory.assert_not_called()
                apt.assert_not_called()

    def test_rollback_prefers_apt_and_never_uses_snapshot_for_node(self):
        with patch.object(maintenance, 'apt') as apt, patch.object(maintenance.urllib.request, 'urlopen') as network:
            self.assertEqual(maintenance.prepare_rollback('tzdata', '2026e-0+deb13u1', Path('/unused')),
                             {'source': 'apt-repository'})
            network.assert_not_called()
            apt.side_effect = RuntimeError('old version absent')
            with self.assertRaisesRegex(RuntimeError, 'old version absent'):
                maintenance.prepare_rollback('nodejs', '24.22.2-1nodesource1', Path('/unused'))
            network.assert_not_called()

    def test_cached_rollback_requires_protected_exact_snapshot_binary(self):
        data = b'cached old package'; version = '2026e-0+deb13u1'
        digest = hashlib.sha1(data).hexdigest()
        proof = {'binary': 'tzdata', 'binary_version': version,
                 'result': [{'architecture': 'all', 'hash': digest}],
                 'fileinfo': {digest: [{'name': 'tzdata_' + version + '_all.deb',
                                        'size': len(data), 'archive_name': 'debian'}]}}
        cases = ['valid', 'bad-hash', 'bad-version', 'bad-size', 'bad-architecture', 'bad-owner', 'writable', 'symlink', 'bad-control']
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); cache = root / 'cache'; cache.mkdir(); backup = root / 'backup'; backup.mkdir()
                path = cache / ('tzdata_' + version + '_all.deb'); path.write_bytes(data)
                value = json.loads(json.dumps(proof))
                if case == 'bad-hash': value['result'][0]['hash'] = '0' * 40
                if case == 'bad-version': value['binary_version'] = 'different'
                if case == 'bad-size': value['fileinfo'][digest][0]['size'] += 1
                if case == 'bad-architecture': value['result'][0]['architecture'] = 'arm64'
                if case == 'symlink':
                    path.rename(root / 'other'); path.symlink_to(root / 'other')
                metadata = SimpleNamespace(st_uid=1001 if case == 'bad-owner' else 0,
                                           st_mode=0o100666 if case == 'writable' else 0o100644)
                control = 'Package: tzdata\nVersion: ' + version + '\nArchitecture: all'
                if case == 'bad-control': control = control.replace('tzdata', 'other')
                with patch.object(maintenance, 'APT_CACHE', cache), \
                     patch.object(maintenance, 'apt', side_effect=RuntimeError('old version absent')), \
                     patch.object(maintenance.os, 'fstat', return_value=metadata), \
                     patch.object(maintenance.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(value).encode())) as network, \
                     patch.object(infra, 'text', return_value=control):
                    if case == 'valid':
                        result = maintenance.prepare_rollback('tzdata', version, backup)
                        self.assertEqual((backup / path.name).read_bytes(), data)
                        self.assertEqual(result['sha256'], hashlib.sha256(data).hexdigest())
                        self.assertEqual(result['snapshotSha1'], digest)
                        network.assert_called_once_with('https://snapshot.debian.org/mr/binary/tzdata/2026e-0%2Bdeb13u1/binfiles?fileinfo=1', timeout=30)
                    else:
                        with self.assertRaises((RuntimeError, OSError)):
                            maintenance.prepare_rollback('tzdata', version, backup)
                        self.assertEqual(list(backup.iterdir()), [])

    def test_only_reviewed_exact_minor_versions_are_allowed(self):
        before = {'packages': {'nodejs': {'installed': '24.21.0-1nodesource1', 'candidate': '24.22.2-1nodesource1'},
                               'tzdata': {'installed': '2026c-0+deb13u1', 'candidate': '2026e-0+deb13u1'}}, 'heldPackages': []}
        self.assertEqual(maintenance.reviewed_targets(['nodejs=24.22.2-1nodesource1'], before), {'nodejs': '24.22.2-1nodesource1'})
        for target in ['nodejs', 'nginx=1.26.3', 'nodejs=24.22.1', 'nodejs=24.22.2;reboot']:
            with self.assertRaises((ValueError, RuntimeError)):
                maintenance.reviewed_targets([target], before)
        before['packages']['nodejs']['candidate'] = '26.13.0-1nodesource1'
        with self.assertRaisesRegex(RuntimeError, 'majeure'):
            maintenance.reviewed_targets(['nodejs=26.13.0-1nodesource1'], before)
        before['heldPackages'] = ['tzdata']
        with self.assertRaises(RuntimeError):
            maintenance.reviewed_targets(['tzdata=2026e-0+deb13u1'], before)

    def test_dependency_and_removal_changes_abort(self):
        maintenance.validate_apt_plan('Inst nodejs [24.21.0] (24.22.2)\nConf nodejs (24.22.2)', {'nodejs': '24.22.2'})
        for plan in ['Remv nginx\nInst nodejs (24.22.2)', 'Inst nodejs (24.22.2)\nInst libc6 (2.42)', '']:
            with self.assertRaisesRegex(RuntimeError, 'supplémentaires'):
                maintenance.validate_apt_plan(plan, {'nodejs': '24.22.2'})

    def test_window_uses_paris_in_winter_and_summer(self):
        for month, utc_hour in [(1, 3), (7, 2)]:
            start, end = maintenance.restart_window(dt.datetime(2026, month, 10, 0, tzinfo=dt.timezone.utc))
            self.assertEqual((start.hour, start.minute), (utc_hour, 40))
            self.assertEqual((end.hour, end.minute), (utc_hour + 1, 30))
        start, _ = maintenance.restart_window(dt.datetime(2026, 10, 29, 6, tzinfo=dt.timezone.utc))
        self.assertEqual(start.day, 30)

    def test_stale_backups_abort_before_package_mutation(self):
        with patch.object(infra, 'latest_backup', return_value=None), patch.object(infra, 'read_state', return_value={}), \
             patch.object(maintenance, 'apt') as apt:
            with self.assertRaisesRegex(RuntimeError, 'Sauvegarde'):
                maintenance.verify_recent_backups()
            apt.assert_not_called()

    def test_real_inode_change_requires_runtime_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'node'
            path.write_text('old')
            with path.open() as live:
                replacement = Path(directory) / 'new'
                replacement.write_text('new')
                replacement.replace(path)
                self.assertFalse(Path('/proc/self/fd/' + str(live.fileno())).samefile(path))

    def plan(self):
        return {'status': 'scheduled', 'notBefore': '2026-01-01T00:00:00+00:00',
                'expiresAt': '2099-01-01T00:00:00+00:00', 'nodeSha256': 'unused'}

    def test_busy_cortex_is_never_restarted(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(infra, 'STATE', Path(directory)), \
             patch.object(infra, 'maintenance_lock', return_value=contextlib.nullcontext()), \
             patch.object(maintenance, 'UPDATER_LOCK', Path(directory) / 'updater.lock'), \
             patch.object(maintenance, 'cortex_pid', return_value=123), \
             patch.object(maintenance, 'runtime_current', return_value=False), \
             patch.object(maintenance.hashlib, 'sha256') as sha, \
             patch.object(maintenance, 'queue_idle', return_value=False), patch.object(infra, 'run') as run:
            maintenance.UPDATER_LOCK.touch()
            infra.atomic_json(infra.STATE / 'runtime-restart.json', self.plan())
            sha.return_value.hexdigest.return_value = 'unused'
            result = maintenance.run_runtime_restart()
            self.assertEqual(result['status'], 'deferred')
            run.assert_not_called()

    def test_interrupted_restart_is_not_repeated(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(infra, 'STATE', Path(directory)), \
             patch.object(infra, 'maintenance_lock', return_value=contextlib.nullcontext()), \
             patch.object(maintenance, 'UPDATER_LOCK', Path(directory) / 'updater.lock'), \
             patch.object(maintenance, 'cortex_pid', return_value=123), \
             patch.object(maintenance, 'runtime_current', return_value=False), patch.object(infra, 'run') as run:
            maintenance.UPDATER_LOCK.touch()
            infra.atomic_json(infra.STATE / 'runtime-restart.json', {**self.plan(), 'status': 'restarting'})
            self.assertEqual(maintenance.run_runtime_restart()['status'], 'failed')
            run.assert_called_once_with(['systemctl', 'disable', '--now', maintenance.RUNTIME_TIMER])

    def test_expired_plan_does_not_restart(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(infra, 'STATE', Path(directory)), \
             patch.object(infra, 'maintenance_lock', return_value=contextlib.nullcontext()), \
             patch.object(maintenance, 'UPDATER_LOCK', Path(directory) / 'updater.lock'), \
             patch.object(maintenance, 'cortex_pid', return_value=123), \
             patch.object(maintenance, 'runtime_current', return_value=False), patch.object(infra, 'run') as run:
            maintenance.UPDATER_LOCK.touch()
            infra.atomic_json(infra.STATE / 'runtime-restart.json', {**self.plan(), 'expiresAt': '2026-01-01T01:00:00+00:00'})
            self.assertEqual(maintenance.run_runtime_restart()['status'], 'expired')
            run.assert_called_once_with(['systemctl', 'disable', '--now', maintenance.RUNTIME_TIMER])

    def test_installed_binary_alone_does_not_prove_recovery(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(infra, 'STATE', Path(directory)), \
             patch.object(infra, 'maintenance_lock', return_value=contextlib.nullcontext()), \
             patch.object(maintenance, 'UPDATER_LOCK', Path(directory) / 'updater.lock'), \
             patch.object(maintenance, 'cortex_pid', return_value=123), \
             patch.object(maintenance, 'runtime_current', return_value=True), \
             patch.object(infra, 'collect', return_value={'summary': {'critical': 1, 'unknown': 0}}), patch.object(infra, 'run') as run:
            maintenance.UPDATER_LOCK.touch()
            infra.atomic_json(infra.STATE / 'runtime-restart.json', self.plan())
            self.assertEqual(maintenance.run_runtime_restart()['status'], 'deferred')
            run.assert_not_called()

    def test_idle_restart_is_persisted_before_restart_and_health_verified(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(infra, 'STATE', Path(directory)), \
             patch.object(infra, 'maintenance_lock', return_value=contextlib.nullcontext()), \
             patch.object(maintenance, 'UPDATER_LOCK', Path(directory) / 'updater.lock'), \
             patch.object(maintenance, 'cortex_pid', return_value=123), \
             patch.object(maintenance, 'runtime_current', side_effect=[False, True]), \
             patch.object(maintenance.hashlib, 'sha256') as sha, \
             patch.object(maintenance, 'queue_idle', return_value=True), patch.object(maintenance, 'workers_idle', return_value=True), \
             patch.object(maintenance, 'verify_recent_backups'), patch.object(maintenance.time, 'sleep'), \
             patch.object(infra, 'collect', return_value={'summary': {'critical': 0, 'unknown': 0}}), \
             patch.object(infra, 'authorize_attempt'), patch.object(infra, 'user_systemctl', return_value=['restart-cortex']), \
             patch.object(infra, 'run') as run:
            maintenance.UPDATER_LOCK.touch()
            infra.atomic_json(infra.STATE / 'runtime-restart.json', self.plan())
            sha.return_value.hexdigest.return_value = 'unused'
            def check(command, **kwargs):
                if command == ['restart-cortex']:
                    self.assertEqual(infra.read_state('runtime-restart.json', {})['status'], 'restarting')
            run.side_effect = check
            self.assertEqual(maintenance.run_runtime_restart()['status'], 'succeeded')
            self.assertEqual(run.call_count, 2)

    def test_periodic_probe_remains_passive(self):
        self.assertIn('lunaria-infra collect', install_system.SERVICE_TEXT)
        self.assertNotIn('runtime-maintenance', install_system.SERVICE_TEXT)
        self.assertIn('OnBootSec=3min', install_system.BOOT_TIMER_TEXT)


class ResolverTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.base = Path(self.scratch.name)
        self.config = self.base / 'resolved.conf.d' / '70-lunaria-infra.conf'
        self.backup = self.base / 'backup'
        self.backup.mkdir()
        self.state = self.base / 'state'
        self.state.mkdir()
        for name, value in [('RESOLVER', self.config), ('STATE', self.state)]:
            handle = patch.object(install_system, name, value)
            handle.start()
            self.addCleanup(handle.stop)
        handle = patch.object(install_system.subprocess, 'run',
                              return_value=subprocess.CompletedProcess([], 0, stdout=''))
        self.run = handle.start()
        self.addCleanup(handle.stop)

    def test_root_only_directory_becomes_readable_by_resolver(self):
        self.config.parent.mkdir(mode=0o700)
        install_system.harden_dns_resolver(self.backup)
        self.assertEqual(self.config.parent.stat().st_mode & 0o777, 0o755)
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.config.read_text(), install_system.RESOLVER_TEXT)
        self.assertEqual(json.loads((self.state / 'resolver-hardening.json').read_text())['status'], 'succeeded')
        self.assertEqual(json.loads((self.backup / 'resolver-before.json').read_text())['directoryMode'], 0o700)

    def test_restrictive_umask_does_not_hide_new_configuration(self):
        mask = os.umask(0o077)
        try:
            install_system.harden_dns_resolver(self.backup)
        finally:
            os.umask(mask)
        self.assertEqual(self.config.parent.stat().st_mode & 0o777, 0o755)
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o644)

    def test_unknown_private_configuration_permissions_are_preserved(self):
        self.config.parent.mkdir(mode=0o700)
        private = self.config.parent / 'private.conf'
        private.write_text('preserve')
        with self.assertRaisesRegex(RuntimeError, 'inconnues'):
            install_system.harden_dns_resolver(self.backup)
        self.assertEqual(self.config.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(private.read_text(), 'preserve')
        self.run.assert_not_called()

    def test_failed_dns_rolls_back_directory_and_verifies_recovery(self):
        self.config.parent.mkdir(mode=0o700)
        with patch.object(install_system, 'resolver_query', side_effect=[None, RuntimeError('DNS failed'), None]) as query:
            with self.assertRaisesRegex(RuntimeError, 'DNS failed'):
                install_system.harden_dns_resolver(self.backup)
        self.assertEqual(query.call_count, 3)
        self.assertFalse(self.config.exists())
        self.assertEqual(self.config.parent.stat().st_mode & 0o777, 0o700)
        evidence = json.loads((self.state / 'resolver-hardening.json').read_text())
        self.assertEqual(evidence['status'], 'rolled-back')
        self.assertTrue(evidence['rollbackDnsValidated'])

    def test_remaining_listener_restores_existing_file_and_mode(self):
        self.config.parent.mkdir()
        previous = '# Managed by Cortex ops/lunaria-infra/install_system.py\n[Resolve]\nLLMNR=yes\n'
        self.config.write_text(previous)
        self.config.chmod(0o600)
        self.run.return_value.stdout = 'LISTEN 0 4096 0.0.0.0:5355'
        with self.assertRaisesRegex(RuntimeError, 'écoute encore'):
            install_system.harden_dns_resolver(self.backup)
        self.assertEqual(self.config.read_text(), previous)
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o600)

    def test_failed_recovery_is_never_reported_as_rolled_back(self):
        with patch.object(install_system, 'resolver_query',
                          side_effect=[None, RuntimeError('DNS failed'), RuntimeError('recovery failed')]):
            with self.assertRaisesRegex(RuntimeError, 'Retour arrière DNS non validé'):
                install_system.harden_dns_resolver(self.backup)
        self.assertFalse(self.config.parent.exists())
        evidence = json.loads((self.state / 'resolver-hardening.json').read_text())
        self.assertEqual(evidence['status'], 'rollback-required')
        self.assertEqual(evidence['rollbackError'], 'recovery failed')


if __name__ == '__main__':
    unittest.main()
