import contextlib
import copy
import io
import json
from pathlib import Path
import subprocess
import tempfile
import tarfile
import unittest
from unittest.mock import patch

import infra_health as infra


class InfraTest(unittest.TestCase):
    def test_thresholds(self):
        self.assertEqual(infra.threshold(18, 85, 95), 'ok')
        self.assertEqual(infra.threshold(87, 85, 95), 'warning')
        self.assertEqual(infra.threshold(96, 85, 95), 'critical')
        self.assertEqual(infra.threshold(4, 10, 5, lower=True), 'critical')
        self.assertEqual(infra.threshold(12, 21, 7, lower=True), 'warning')

    def test_restore_target_cannot_be_production(self):
        for name in ['lunaria', 'postgres', 'lunaria_infra_restore_../lunaria', 'lunaria_infra_restore_abc']:
            with self.assertRaises(ValueError):
                infra.check_restore_name(name)
        infra.check_restore_name('lunaria_infra_restore_0123456789abcdef')

    def test_archive_paths(self):
        for name in ['/etc/shadow', '../secrets', 'mail/../../outside', 'mail\\..\\secret']:
            self.assertFalse(infra.safe_member(name))
        self.assertTrue(infra.safe_member('mail/box/cur/message'))

    def test_service_allowlist(self):
        with patch('infra_health.run') as runner:
            with self.assertRaises(ValueError):
                infra.repair_service('ssh.service')
            runner.assert_not_called()

    def test_active_cortex_cannot_interrupt_itself(self):
        with patch('infra_health.unit_state', return_value={'LoadState': 'loaded', 'ActiveState': 'active'}), patch('infra_health.run') as runner:
            with self.assertRaisesRegex(RuntimeError, 'Ne pas interrompre'):
                infra.repair_service('cortex.service')
            runner.assert_not_called()

    def test_nginx_configuration_is_checked_before_restart(self):
        calls = []
        with patch('infra_health.unit_state', side_effect=[{'LoadState': 'loaded', 'ActiveState': 'failed'}, {'ActiveState': 'active'}]), \
             patch('infra_health.run', side_effect=lambda args, **kwargs: calls.append(args)):
            result = infra.repair_service('nginx.service')
        self.assertEqual(calls[0], ['nginx', '-t'])
        self.assertEqual(calls[1], ['systemctl', 'restart', 'nginx.service'])
        self.assertEqual(result['after'], 'active')

    def test_failed_nginx_validation_does_not_restart(self):
        with patch('infra_health.unit_state', return_value={'LoadState': 'loaded', 'ActiveState': 'failed'}), \
             patch('infra_health.run', side_effect=RuntimeError('invalid')) as runner:
            with self.assertRaises(RuntimeError):
                infra.repair_service('nginx.service')
            self.assertEqual(runner.call_count, 1)

    def test_restart_transition_is_not_interrupted(self):
        with patch('infra_health.unit_state', return_value={'LoadState': 'loaded', 'ActiveState': 'activating'}), patch('infra_health.run') as runner:
            with self.assertRaises(RuntimeError):
                infra.repair_service('lunaria-backend.service')
            runner.assert_not_called()

    def test_cooldown_and_attempt_limit(self):
        with tempfile.TemporaryDirectory() as directory, patch('infra_health.STATE', Path(directory)), patch('infra_health.time.time', return_value=10000):
            infra.authorize_attempt('test')
            with self.assertRaisesRegex(RuntimeError, 'dix minutes'):
                infra.authorize_attempt('test')
            with patch('infra_health.time.time', return_value=11000):
                infra.authorize_attempt('test')
            with patch('infra_health.time.time', return_value=12000):
                with self.assertRaisesRegex(RuntimeError, 'Deux tentatives'):
                    infra.authorize_attempt('test')

    def test_stale_exim_requires_proven_conditions(self):
        with tempfile.TemporaryDirectory() as directory, patch('infra_health.STATE', Path(directory)), \
             patch('infra_health.maintenance_lock', return_value=contextlib.nullcontext()), \
             patch('infra_health.unit_state', return_value={'LoadState': 'loaded', 'ActiveState': 'failed'}), patch('infra_health.run') as runner:
            with self.assertRaisesRegex(RuntimeError, 'conditions'):
                infra.execute_action('clear-stale-exim')
            runner.assert_not_called()

    def test_stale_exim_only_clears_missing_timer(self):
        with tempfile.TemporaryDirectory() as directory, patch('infra_health.STATE', Path(directory)), \
             patch('infra_health.maintenance_lock', return_value=contextlib.nullcontext()), \
             patch('infra_health.unit_state', side_effect=[{'LoadState': 'not-found', 'ActiveState': 'failed'}, {'ActiveState': 'active'}]), \
             patch('infra_health.run') as runner:
            result = infra.execute_action('clear-stale-exim')
            runner.assert_called_once_with(['systemctl', 'reset-failed', 'exim4-base.timer'])
            self.assertFalse(result['unitFilesModified'])

    def test_redaction(self):
        value = infra.redact('password=example token=abc Authorization=Bearer very-secret-value user@example.org https://example.org/?secret=123')
        self.assertNotIn('example.org/?secret=123', value)
        self.assertNotIn('user@example.org', value)
        self.assertNotIn('password=example', value)
        self.assertNotIn('token=abc', value)
        self.assertNotIn('very-secret-value', value)

    def test_actual_deployment_lock_blocks_repair(self):
        import fcntl
        with tempfile.TemporaryDirectory() as directory:
            deploy = Path(directory) / 'deploy.lock'
            deploy.touch()
            with deploy.open('a') as lease:
                fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with patch('infra_health.DEPLOY_LOCK', deploy), patch('infra_health.MAINTENANCE_LOCK', Path(directory) / 'maintenance.lock'):
                    with self.assertRaisesRegex(RuntimeError, 'en cours'):
                        with infra.maintenance_lock():
                            self.fail('must not acquire deployment lock')

    def test_missing_backup_never_creates_or_drops_database(self):
        with patch('infra_health.latest_backup', return_value=None), patch('infra_health.run') as runner:
            with self.assertRaisesRegex(RuntimeError, 'Aucune sauvegarde'):
                infra.verify_backup('site')
            runner.assert_not_called()

    def test_restore_failure_cleans_up_only_its_isolated_database(self):
        with tempfile.TemporaryDirectory() as directory:
            nested = io.BytesIO()
            with tarfile.open(fileobj=nested, mode='w:gz'):
                pass
            archive = Path(directory) / '20261027T000000Z.tar.gz'
            with tarfile.open(archive, 'w:gz') as package:
                for name, data in [('database.dump', b'PGDMP test'), ('media.tar.gz', nested.getvalue()), ('backend.env', b'test')]:
                    item = tarfile.TarInfo(name)
                    item.size = len(data)
                    package.addfile(item, io.BytesIO(data))
            calls = []
            def command(args, **kwargs):
                calls.append(args)
                if 'pg_restore' in args:
                    raise RuntimeError('restore failed')
            with patch('infra_health.latest_backup', return_value=archive), patch('infra_health.run', side_effect=command):
                with self.assertRaisesRegex(RuntimeError, 'restore failed'):
                    infra.verify_backup('site')
            dropped = [args[-1] for args in calls if 'dropdb' in args]
            self.assertEqual(len(dropped), 1)
            infra.check_restore_name(dropped[0])
            self.assertNotEqual(dropped[0], 'lunaria')


if __name__ == '__main__':
    unittest.main()
