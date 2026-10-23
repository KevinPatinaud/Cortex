# Shared execution workspaces

Projects which edit the same checkout can opt into one server-enforced lease in `config.json`:

```json
{
  "executionWorkspaces": [{
    "id": "shared-site",
    "directory": "/srv/site-source",
    "projectIds": ["design-project", "maintenance-project"],
    "git": { "branch": "main", "remote": "origin" },
    "healthChecks": ["http://127.0.0.1:8081/actuator/health"]
  }]
}
```

Use the same entry for every project writing that checkout. The lease spans manual agent execution and full workflows, including isolated runners and nested agents. Another project is refused with HTTP 409; its scheduled occurrence is skipped with an audit explanation. The deployment activation lock remains useful for commands outside Cortex. This guard assumes one Cortex server process, as provided by the production systemd service; independent servers and external shell sessions require their own coordination.

The quota gate remains authoritative. Only an intervention which passes the gate and preflight creates an atomic journal under `data/execution-workspaces/`. A missed cron or rejected launch never creates a recovery obligation. No missed occurrence is replayed and no quota threshold is lowered.

The preflight checks the configured branch, effective Git author, absence of tracked changes and equality between local HEAD and the actual remote branch. Unknown work is preserved and rejected before the agent starts. Untracked build outputs are outside this check; agents must inspect and stage their own files explicitly. An unfinished intervention's owner may resume its dirty checkout. The final check requires tracked changes to be committed, the actual remote hash to match, and each configured JSON health endpoint to report `status: UP`. It runs before an audit can be marked successful. An unchanged audit needs no empty commit.

The journal records the project, timestamps, attempt count, status and last error, without storing prompts or credentials. Failure, cancellation during execution or a stale `running` journal after restart retains ownership. At the next scheduled slot in that workspace, Cortex attempts the owner's recovery once, through the normal quota gate. The scheduled task whose slot was used is skipped; it is not queued afterwards. The agent receives instructions to inspect existing effects and complete or safely restore the already-started intervention before selecting new work. Project-level business state and proof still belong in the agent's durable reports.

An explicit `waiting` result reserves the workspace but does not trigger early recovery: the existing wait scheduler owns its wake. Incidents remain visible in workflow audits, scheduled occurrence errors and the private journal. These facilities do not send external notifications and do not establish semantic or visual correctness; those remain part of the agent's validation task.

Back up configuration, journals and SQLite before changing this configuration or deploying the server. Never discard an unfinished journal to bypass an unresolved source or production state. If its project has been removed, reconcile the checkout and release before deliberately transferring or closing ownership.
