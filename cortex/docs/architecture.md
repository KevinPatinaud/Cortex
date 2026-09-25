# Architecture and maintenance boundaries

The application lives in `cortex/`; Git and GitHub Actions use its parent directory.
The [application README](../README.md) is the functional reference. The root README
links to it rather than maintaining a second feature description.

## Execution and persistence

- `AgentUseCase` coordinates loaded projects, agents, sessions, routing and audit.
  It remains the application facade. Keep new provider or authoring contracts out
  of this facade when they belong in one of the services below.
- `workflowDefinition/WorkflowDefinitionService` constructs and validates graph
  proposals. `ProjectAuthoringService` builds and validates improvement/review
  requests. These services do not own execution state or HTTP handlers.
- `workflowExecution/WorkflowRunner` advances ready branches, drains requests
  already in flight before returning an error, and classifies suspension,
  cancellation and failure. `WorkflowCheckpoint` validates checkpoint data and
  definition fingerprints; the facade restores sessions into its project maps.
- `executionControl/ExecutionControlService` is the single production gateway
  used by `AgentService` before calling a provider. It checks both source and target
  project policies after acquiring a shared slot and before persisting a call.
  The per-instance callback counts fan-out requests, not graph iterations.
- `SqliteExecutionControlRepository` stores policies and request/token accounting
  in the audit database. The execution audit continues to record detailed prompts,
  responses and run events separately. Availability probes do not invoke a model.
- Schedulers, automatic wait scans and dossier workers skip paused projects.
  Gateway checks are still required: a pause can occur after a worker's first check.

The tested lifecycle invariants are: started calls may finish after pause;
successor calls cannot begin; checkpoints retain completed work; replies are not
consumed while paused; waiting workflows can wake after reactivation; interrupted
work requires explicit resumption. A missing graph cache during paused loading
must never erase the checkpoint. Daily counters survive reset and restart, while
instance counters also survive midnight and retry.

## Files and runtime

`ProjectContentReader` separates bounded definition reads from explicit bounded
tree inspection. `ProjectService` handles project mutations. Full project loading
refreshes definitions, while the runtime endpoint reuses the loaded project and
only refreshes execution fields. File contents and prompts are not sent by runtime
polling. All endpoint adapters remain in `infrastructure/web/controller`.

## Interface

`AgentProjectWorkspace` composes the graph and user actions. `useWorkflowPolling`
owns refresh intervals, cancellation and runtime merging. `ProjectExecutionControls`
owns pause, consumption and editable budgets. `WorkflowDossiers` retains dossier
actions; its resume controls follow the project pause state.

`src/front/styles.css` is an ordered import manifest. Its domain files live under
`styles/`. Ordering is intentional: legacy responsive and interaction refinements
override earlier component rules. The initial extraction preserved all declarations
and the compiled CSS byte-for-byte. Add new domain styles to their matching module;
do not reorder imports without checking browser journeys at every supported width.

## Validation

Run `npm run check` from `cortex/`, then `npm run test:e2e` for changes to these
execution and interface paths. The browser harness creates temporary projects and
databases and injects simulated providers. It verifies behavior and accessibility
without making billable model requests. Provider usage parsing has separate fixture
tests; these do not prove live provider token reporting for every installed version.

GitHub Actions runs the same checks on Windows and Linux at widths 390, 700, 980
and 1440 px. A local successful campaign does not prove the remote workflow has run;
verify its jobs after the change is pushed.
