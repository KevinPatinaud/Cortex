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

The preflight checks the configured branch, effective Git author, absence of tracked changes and equality between local HEAD and the actual remote branch. If a clean checkout is behind, Cortex fetches the configured remote branch and fast-forwards it under the lease, after the quota gate. It then verifies the branch, tracked work and actual remote hash again before starting the agent. A stale `origin/main` tracking ref is not accepted as proof of synchronization. Local-only commits, divergent histories, dirty tracked files and untracked path collisions block the launch while preserving the existing work. There is no automatic push, stash, reset or conflict resolution. Untracked build outputs are otherwise outside this check; agents must inspect and stage their own files explicitly. An unfinished intervention's owner may resume its dirty checkout without synchronizing over that intervention. The final check never pulls: it requires tracked changes to be committed, the actual remote hash to match, and each configured JSON health endpoint to report `status: UP`. It runs before an audit can be marked successful. An unchanged audit needs no empty commit.

The journal records the project, timestamps, attempt count, status and last error, without storing prompts or credentials. Failure, cancellation during execution or a stale `running` journal after restart retains ownership. At the next scheduled slot in that workspace, Cortex attempts the owner's recovery once, through the normal quota gate. The scheduled task whose slot was used is skipped; it is not queued afterwards. The agent receives instructions to inspect existing effects and complete or safely restore the already-started intervention before selecting new work. Project-level business state and proof still belong in the agent's durable reports.

An explicit `waiting` result keeps its business checkpoint and existing wake scheduler. If the checkout is verified as committed, published and healthy, its journal becomes `released` and other projects may use it during that suspension. If validation fails, the reservation remains until the owner wakes or its state is reconciled. The next execution verifies the checkout again before editing.

The journal identifies the durable checkpoint, including an isolated instance's checkpoint key. Legacy reservations are reconciled under an exclusive probe lease: a clean published checkout can be released; an ended, cancelled or reset wait with unpublished effects becomes a cleanup obligation. Manual intermediate results without an actual durable wait are marked `interrupted`, so the next eligible occurrence can recover them. If the original project is deleted or removed from the resource mapping, a remaining project takes responsibility solely for closing or restoring existing effects. A cancelled objective is not continued.

Resource acquisition never queues behind an existing lease: it rejects immediately. Nested agents of the same execution are reentrant; opposing acquisitions across distinct resources cannot form a circular resource wait. Live leases are released in `finally`, including after journal I/O errors, and a lease may only remove its own map entry. Git and HTTP probes have bounded timeouts. An active writer is not unlocked based on age; cancelling a provider must settle its execution before another writer can begin. This preserves safety but cannot guarantee progress through an unresponsive provider, filesystem or unavailable external service. There is no new agent execution time limit.

Incidents remain visible in workflow audits, scheduled occurrence errors and the private journal. These facilities do not send external notifications and do not establish semantic or visual correctness; those remain part of the agent's validation task.

Back up configuration, journals and SQLite before changing this configuration or deploying the server. Never discard an unfinished journal to bypass an unresolved source or production state. Automatic cleanup handoff preserves the original project identifier and the previous incident in the recovery instructions.
