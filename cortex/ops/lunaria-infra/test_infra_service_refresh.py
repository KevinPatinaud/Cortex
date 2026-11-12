import contextlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import infra_health as infra
import infra_maintenance as maintenance
import infra_service_refresh as refresh
import install_system


class RefreshTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.install_patch(infra, 'STATE', self.root)
        lease = self.root / 'updater.lock'; lease.touch()
        self.install_patch(maintenance, 'UPDATER_LOCK', lease)
        locks = [self.root / 'dpkg.lock', self.root / 'frontend.lock']
        for path in locks: path.touch()
        self.install_patch(refresh, 'PACKAGE_LOCKS', locks)
        self.install_patch(infra, 'maintenance_lock', return_value=contextlib.nullcontext())
        self.run_tool = self.install_patch(infra, 'run')
        self.backups = self.install_patch(maintenance, 'verify_recent_backups')
        self.quiet = self.install_patch(refresh, 'quiet')
        self.snapshot = self.install_patch(refresh, 'service_snapshot', return_value={
            'pid': 123, 'staleSystemMappings': ['/usr/lib/libold.so (deleted)']})
        self.verify = self.install_patch(refresh, 'verify_service', return_value={
            'pid': 456, 'staleSystemMappings': [], 'verifiedAt': '2026-01-01T00:00:00+00:00'})
        self.install_patch(infra, 'collect', return_value={'summary': {'critical': 0, 'unknown': 0, 'warning': 2}})
        self.install_patch(infra, 'authorize_attempt')
        self.install_patch(refresh.time, 'sleep')

    def install_patch(self, target, name, *args, **kwargs):
        item = patch.object(target, name, *args, **kwargs)
        value = item.start(); self.addCleanup(item.stop)
        return value

    def write_plan(self, **updates):
        value = {'status': 'scheduled', 'notBefore': '2000-01-01T00:00:00+00:00',
                 'expiresAt': '2099-01-01T00:00:00+00:00', 'services': ['dovecot.service'], 'results': {}}
        value.update(updates); infra.atomic_json(self.root / refresh.STATE_FILE, value)

    def mutations(self):
        return [call.args[0] for call in self.run_tool.call_args_list
                if call.args[0][:2] in (['systemctl', 'restart'], ['systemctl', 'reload'])]

    def test_outside_window_never_runs_preflight_or_actions(self):
        self.write_plan(notBefore='2098-01-01T00:00:00+00:00')
        self.assertEqual(refresh.run()['status'], 'outside-window')
        self.backups.assert_not_called(); self.run_tool.assert_not_called()

    def test_expired_plan_is_disabled_without_actions(self):
        self.write_plan(expiresAt='2001-01-01T00:00:00+00:00')
        self.assertEqual(refresh.run()['status'], 'expired')
        self.backups.assert_not_called(); self.assertEqual(self.mutations(), [])
        self.run_tool.assert_called_once_with(['systemctl', 'disable', '--now', refresh.TIMER])

    def test_busy_or_unsafe_preflight_defers_without_actions(self):
        for failure in ['quiet', 'backups', 'configuration', 'health']:
            with self.subTest(failure=failure):
                self.run_tool.reset_mock(); self.quiet.side_effect = None; self.backups.side_effect = None
                self.run_tool.side_effect = None; self.write_plan()
                if failure == 'quiet': self.quiet.side_effect = RuntimeError('busy')
                if failure == 'backups': self.backups.side_effect = RuntimeError('backup stale')
                if failure == 'configuration': self.run_tool.side_effect = RuntimeError('invalid config')
                with patch.object(infra, 'collect', return_value={'summary': {
                    'critical': 1 if failure == 'health' else 0, 'unknown': 0}}):
                    self.assertEqual(refresh.run()['status'], 'deferred')
                self.assertEqual(self.mutations(), [])

    def test_restart_state_is_durable_before_action_and_result_verified(self):
        self.write_plan()
        def action(command, **kwargs):
            if command[:2] == ['systemctl', 'restart']:
                durable = infra.read_state(refresh.STATE_FILE, {})
                self.assertEqual(durable['status'], 'running')
                self.assertEqual(durable['results']['dovecot.service']['status'], 'refreshing')
        self.run_tool.side_effect = action
        result = refresh.run()
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(self.mutations(), [['systemctl', 'restart', 'dovecot.service']])
        self.verify.assert_called_once_with('dovecot.service')
        self.assertEqual(result['results']['dovecot.service']['status'], 'succeeded')

    def test_ssh_only_reloads_and_never_restarts(self):
        self.write_plan(services=['ssh.service'])
        self.assertEqual(refresh.run()['status'], 'succeeded')
        self.assertEqual(self.mutations(), [['systemctl', 'reload', 'ssh.service']])
        self.run_tool.assert_any_call(['/usr/sbin/sshd', '-t'], timeout=30)

    def test_partial_failure_stops_and_is_never_replayed(self):
        self.write_plan(services=['dovecot.service', 'rspamd.service'])
        self.verify.side_effect = RuntimeError('return not validated')
        self.assertEqual(refresh.run()['status'], 'failed')
        self.assertEqual(self.mutations(), [['systemctl', 'restart', 'dovecot.service']])
        self.assertEqual(refresh.run()['status'], 'no-pending-plan')
        self.assertEqual(len(self.mutations()), 1)

    def test_interrupted_operation_requires_reconciliation(self):
        self.write_plan(status='running')
        self.assertEqual(refresh.run()['status'], 'failed')
        self.backups.assert_not_called(); self.assertEqual(self.mutations(), [])

    def test_plan_cannot_inject_services_or_repeat_unreconciled_work(self):
        self.write_plan(services=['cortex.service'])
        self.assertEqual(refresh.run()['status'], 'deferred')
        self.assertEqual(self.mutations(), [])
        for status in ['scheduled', 'deferred', 'running', 'failed']:
            self.write_plan(status=status)
            with self.assertRaisesRegex(RuntimeError, 'Réconcilier'): refresh.plan()

    def test_plan_is_persisted_before_timer_and_only_selects_stale_services(self):
        observed = {'services': {'dovecot.service': {'staleSystemMappings': ['old']},
                                 'ssh.service': {'staleSystemMappings': []}}}
        def action(command, **kwargs):
            durable = infra.read_state(refresh.STATE_FILE, {})
            self.assertEqual(durable['status'], 'scheduled')
            self.assertEqual(durable['services'], ['dovecot.service'])
        self.run_tool.side_effect = action
        with patch.object(refresh, 'inventory', return_value=observed):
            self.assertEqual(refresh.plan()['status'], 'scheduled')
        self.run_tool.assert_called_once_with(['systemctl', 'enable', '--now', refresh.TIMER])

    def test_already_refreshed_service_is_not_restarted(self):
        self.write_plan(); self.snapshot.return_value = {'pid': 456, 'staleSystemMappings': []}
        result = refresh.run()
        self.assertEqual(result['status'], 'succeeded'); self.assertEqual(self.mutations(), [])
        self.assertEqual(result['results']['dovecot.service']['status'], 'already-current')

    def test_busy_lock_never_overwrites_durable_plan(self):
        self.write_plan(); before = (self.root / refresh.STATE_FILE).read_bytes()
        with patch.object(infra, 'maintenance_lock', side_effect=RuntimeError('deployment busy')):
            self.assertEqual(refresh.run()['status'], 'busy')
        self.assertEqual((self.root / refresh.STATE_FILE).read_bytes(), before)
        self.run_tool.assert_not_called()

    def test_actual_posix_package_lock_blocks_worker(self):
        path = refresh.PACKAGE_LOCKS[0]
        program = "import fcntl,sys; f=open(sys.argv[1],'r+'); fcntl.lockf(f,fcntl.LOCK_EX); print('ready',flush=True); sys.stdin.read()"
        child = subprocess.Popen([sys.executable, '-c', program, str(path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            self.write_plan(); before = (self.root / refresh.STATE_FILE).read_bytes()
            self.assertEqual(refresh.run()['status'], 'busy')
            self.assertEqual((self.root / refresh.STATE_FILE).read_bytes(), before)
            self.run_tool.assert_not_called()
        finally:
            child.communicate('', timeout=5)

    def test_passive_probe_does_not_execute_planned_maintenance(self):
        self.assertNotIn('service-refresh', install_system.SERVICE_TEXT)
        self.assertIn('service-refresh-maintenance', install_system.SERVICES_SERVICE_TEXT)
        self.assertIn('Unit=lunaria-infra-services.service', install_system.SERVICES_TIMER_TEXT)


class ObservationTest(unittest.TestCase):
    def test_real_maps_ignore_deleted_anonymous_memory(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '123'; path.mkdir()
            (path / 'maps').write_text('a b c d e /dev/zero (deleted)\na b c d e /tmp/doveconf (deleted)\n'
                                      'a b c d e /usr/lib/libold.so (deleted)\na b c d e /usr/bin/python3 (deleted)\n')
            with patch.object(refresh, 'PROC', Path(directory)), patch.object(infra, 'unit_state', return_value={
                    'ActiveState': 'active', 'SubState': 'running'}), patch.object(infra, 'text', return_value='123'):
                value = refresh.service_snapshot('dovecot.service')
                self.assertEqual(len(value['staleSystemMappings']), 2)
                with self.assertRaises(ValueError): refresh.service_snapshot('cortex.service')

    def test_quiet_checks_workers_backups_transactions_and_expiry(self):
        plan = {'expiresAt': '2099-01-01T00:00:00+00:00'}
        with patch.object(maintenance, 'cortex_pid', return_value=123), \
             patch.object(maintenance, 'queue_idle', return_value=True) as queue, \
             patch.object(maintenance, 'workers_idle', return_value=True), \
             patch.object(infra, 'unit_state', return_value={'ActiveState': 'inactive'}) as unit, \
             patch.object(infra, 'sql', return_value='0') as sql:
            refresh.quiet(plan)
            queue.return_value = False
            with self.assertRaisesRegex(RuntimeError, 'Cortex'): refresh.quiet(plan)
            queue.return_value = True; unit.return_value = {'ActiveState': 'active'}
            with self.assertRaisesRegex(RuntimeError, 'Tâche'): refresh.quiet(plan)
            unit.return_value = {'ActiveState': 'inactive'}; sql.return_value = '1'
            with self.assertRaisesRegex(RuntimeError, 'Transaction'): refresh.quiet(plan)
            with self.assertRaisesRegex(RuntimeError, 'terminée'):
                refresh.quiet({'expiresAt': '2001-01-01T00:00:00+00:00'})

    def test_health_and_fresh_mappings_are_required_after_action(self):
        with patch.object(refresh, 'service_snapshot', return_value={'pid': 456, 'staleSystemMappings': []}), \
             patch.object(infra, 'collect', return_value={'summary': {'critical': 1, 'unknown': 0}}), \
             patch.object(refresh.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'non validée'): refresh.verify_service('dovecot.service')


if __name__ == '__main__':
    unittest.main()
