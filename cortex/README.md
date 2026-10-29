# Cortex

Cortex is a local application for creating, visualizing, and running Codex, Claude, or GitHub Copilot agent workflows. The React frontend is served by an Express API that reads agent configurations directly from saved projects.

In project **History**, open an execution's **Execution journal** to consult its
public agent messages and tool activity, in reception order with local timestamps.
The journal persists in the audit database across failures, cancellation and
server restarts; JSON audit exports include every recorded page. It is recorded
for new executions only. Private reasoning events are excluded. Individual entries
over 64,000 characters retain their first part with an explicit truncation label.
Journal pages load only when expanded; long tool outputs expand separately.

The **Token usage** section records engine-reported input, output and available
cache/reasoning counters per attempt, with mission and interpretation subtotals.
Cached input and reasoning output are not added twice; Claude's separate cache
input categories are normalized into its total input. Codex turn usage and
Copilot per-call events exclude lifetime session/context snapshots. Usage received
before a failure or cancellation remains stored; incomplete attempts are marked
partial. Missing counters and older executions show unavailable, never an assumed
zero. Retrying only a saved interpretation does not count the earlier mission
again. JSON audit exports include the recorded usage.

**Settings → General → Allow simultaneous executions** controls the shared
execution queue for the whole Cortex instance. Disable it to run one complete
agent or prompt at a time across normal workflows, Work Force, Work Light, chats and internal
AI tasks. Ready requests share FIFO order; mission, interpretation and final
checks retain the same reservation. Work Force rejoins at the end after each
agent. Future schedules, quota waits and external-event waits hold no slot.
Quotas and Work Force end times are checked again after a queue wait. Pending
requests can be cancelled; stopping Work Force removes a pending request while
letting an already granted agent finish.

The setting persists in `config.json` as
`executionConcurrency.allowParallelExecutions` and defaults to `false` (one
execution at a time). Enabled mode admits different agents together;
the same configured agent is never admitted twice simultaneously. Each project
then owns repository/resource coordination: the shared workspace reservation and
its publication checks are delegated to the project, while agent execution
policies and checks still apply. Disabling the setting drains active jobs before
admitting another. A single Cortex server process must own the instance. The
authenticated `/api/execution-queue` endpoint exposes active and waiting entries;
`PUT /api/execution-queue/settings` changes the setting.

**Work Force**, accessible from the project sidebar, repeatedly runs a manually
ordered selection of agents from any saved projects. Select agents, drag their
rows using the handle on the left, optionally choose a local start and/or end
date/time, then start or schedule the loop. Every agent requires both Codex
reserves: by default 30% remaining over five hours and 8% over the week. These
mandatory thresholds are independent of the normal workflow rule and can be
changed in Settings → General → Work Force, or on the Work Force page. A refused
or unavailable quota reading is retried every five minutes, keeping the next
agent in place. Execution is sequential and wraps back to the first agent.

Manual stop and the planned end let the current agent finish and prevent further
launches. Start and end dates are independent, stored as UTC instants and shown
in the browser's time zone. The server must stay running; closing the page is
fine. Configuration, pending schedules, quota waits and the next position survive
restarts. An interrupted active agent or a failed/waiting agent pauses the loop
for review before manual restart. Agents reuse their configured engine, model,
instructions, workspace policy and quality checks, with separate Work Force
conversations and audits. Normal workflow edges do not launch extra agents.
The latest 20 execution results are visible on the page; full audits remain in
each project's history. Stop the loop before changing the list or schedule.

Work Force, Work Light and normal schedules can remain enabled together. Each
keeps its own timing and quota thresholds. Work Force requests its next agent
only after its previous agent completes, joining behind already waiting requests.
Work Light and normal schedules enqueue each eligible occurrence at its configured
time, even while Cortex is busy. With parallel executions enabled, different
agents can run together; otherwise all modes share the FIFO. Further occurrences
of the same normal workflow wait for the earlier workflow to finish, while its
successor agents still take individual turns alongside other modes. Quotas are
checked before admission and again at actual launch. A quota refusal releases
the turn; scheduled modes wait for their next occurrence, and Work Force retries
after five minutes. Disabling a normal schedule cancels its pending occurrences.
The sidebar's **Work Force** button turns red while its loop is active, including
quota waits. Normal manual runs, workflow wakes and downstream dossiers remain
eligible throughout.
The lightweight `/api/work-force/status` read used by the button does not query
Codex quotas or start inference.

**Chats et prompts** adds durable prompt queues alongside workflows: prepare
several independent Codex conversations by writing a first message. Titles,
working directories and models are selected automatically. Defaults can be
changed in the dedicated Settings menu and apply to future chats. A compact
composer selector also offers the live Codex catalog and each model's supported
reasoning levels. Each queued prompt keeps the profile selected when it was sent.
The composer accepts images and documents through the paperclip, file dropping
or image pasting. Attachments remain with queued prompts and survive restarts;
images are sent through Codex's native image input and original document paths
are supplied for the engine to read using its local tools.
The clock beside the paperclip optionally sets a local date (today by default)
and time. The stored UTC instant prevents early execution; due prompts still
respect quotas and conversation order. Waiting schedules can be changed or
removed, survive restarts, and require the Cortex server to remain running.
Prompts run
sequentially inside each chat; different chats can run in parallel (two by
default) when the global simultaneous-execution setting allows it. Otherwise,
prompts, normal agents and Work Force all share the same serial execution queue.
Future schedules and quota waits do not reserve a slot; quotas are checked again
when the prompt actually reaches the front of the global queue.
Every automatic departure requires both Codex reserves to meet the
configured thresholds, including when the global workflow quota toggle is off.
The defaults are 50% remaining over five hours and 10% over the week. Queued work
retries automatically as reserves recover. Sending below either threshold opens
a popup with the observed reserves: keep the prompt queued or explicitly force
this attempt. Forcing preserves conversation order and execution capacity;
the next prompt still needs sufficient reserves. See the [prompt queue guide](docs/prompt-queue.md)
for preparation, concurrency, model selection, persistence and recovery.

Scheduled monitoring agents can dispatch independent, durable dossiers within the same project. Cortex identifies asynchronous branches from the project instructions when loading its graph; no separate automation configuration is needed. Dossiers and replies appear below their entry agent, with persistent deduplication and conditional follow-up. See the [workflow guide and real-estate example](docs/workflow-automations.md).

In **Settings → General**, enable the Codex quota launch rule to require at least **50% remaining over five hours** and **10% remaining over the week**. Both thresholds are configurable from 0 to 100% and persist in `config.json` under `codexQuota`. The rule is disabled by default. It applies to all projects and engines, manual agent launches, scheduled workflows, and automatic resumes; already running workflows finish normally. These percentages describe the Codex subscription reserve, not raw token counts or API credits.

Cortex queries its server's authenticated Codex CLI using [`account/rateLimits/read`](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt), without starting an inference turn. The settings button checks that same account and displays the observation time. Missing, invalid, expired, or unavailable five-hour/weekly windows block launches while the rule is enabled. Cron occurrences are skipped with a reason until the next scheduled occurrence; waiting workflows and queued dossiers retain their state and retry automatically. Denied attempts reuse the refusal for up to 60 seconds, while every permitted launch requires a fresh reading. Disabling the rule takes effect on the next attempt.

The Codex model selector reads the deployed CLI's [`model/list`](https://learn.chatgpt.com/docs/app-server#list-models-modellist) catalog in the selected project's directory, including pagination and model-specific reasoning efforts. It displays the CLI version and configured default, and can refresh after a Codex upgrade. Discovery and execution resolve the same executable on the Cortex server; the browser's local Codex installation is irrelevant. No model names are hard-coded for Codex. Missing catalogs show an error and retry action; previously saved model/effort values are preserved and identified when absent from the current catalog. Changing models clears an incompatible effort only as part of that explicit user action. Discovery starts no inference turn; final account access is checked when a real execution runs.

## Automatic Codex updates

Cortex automatically checks for a stable Codex CLI update on startup and every
six hours. It installs verified releases in its own `data/codex-runtime` folder
and waits for running executions before activation. Discovery, execution, quota
reads and plugins use the same active runtime. Failed updates retain the previous
version and retry automatically; the model picker shows progress and offers a
manual recheck through its refresh button. Existing queued model choices remain
unchanged. See the [prompt queue guide](docs/prompt-queue.md) for details.

## Prerequisites

- Node.js 20.19 or later, or Node.js 22.12 and later;
- npm;
- for AI generation and workflow execution, at least one supported engine installed and authenticated (`codex`, `claude`, or GitHub Copilot).

## Getting started

```bash
npm ci
npm start
```

Authentication is disabled while Cortex listens on the local loopback interface.
This command opens Cortex in the default browser. On a headless server, use:

```bash
npm run start:server
```

Authentication is optional for `start:server`. To enable it, pass a password of
at least 12 characters:

```bash
npm run start:server -- --password="choose-a-password-of-at-least-12-characters"
```

When a reverse proxy exposes Cortex over HTTPS while Cortex itself listens on
`127.0.0.1`, enable secure session cookies:

```bash
CORTEX_SECURE_COOKIE=true \
npm run start:server -- --password="choose-a-password-of-at-least-12-characters"
```

The application is then available at <http://127.0.0.1:3000>. The local `config.json` file is created on the first save and is not committed to version control. Its structure is documented in `config.example.json`.

For development with hot reload, use two terminals:

```bash
npm run dev
npm run dev:web
```

Vite serves the frontend and proxies `/api` to the Express server.

## Creating a project

The creation dialog offers two modes:

- **With AI** generates global instructions and agents from a required project description using the active engine.
- **Without AI** creates a minimal project with optional global instructions and no agents. Instructions are saved directly; leaving them blank creates a short template to complete later. Creating and opening this project does not call AI or require an installed engine.

In both modes, choose Codex, Claude, or Copilot for the project's agent format.
You can then edit the global instructions and add agents in the project editor.

## Organizing projects

Select **New folder** in the left sidebar to create a collapsible folder, then
drag projects into it or use the **Organize** button beside a project to choose
its folder. Choose **Unfiled** to return a project to the root of the list.
Folders can be renamed or deleted; deleting a folder returns its projects to
Unfiled and keeps their files intact. Organization is saved in Cortex's
configuration and survives reloads without moving project directories.
Search also finds projects inside collapsed folders. Within each folder,
drag projects or use **Alt + ↑ / ↓** on a project to change their order.

## Importing an existing project

The import controls accept either a project folder or a Cortex `.ctx` archive
in both local and server modes. The browser uploads the selected content to
Cortex, so a remote server never needs direct access to the user's filesystem.
Imported projects are stored in `projects/` by default and are opened
immediately. A project must contain `AGENTS.md` or `CLAUDE.md` at its root.
When the imported project uses a different agent engine, Cortex detects the
active local engine and converts the project automatically. Shared instructions,
agent names, descriptions, prompts, and non-engine project files are preserved.
Engine-specific model settings are reset so the target engine can use compatible
defaults.

Imports are limited to 100 MB, 2,000 files, and 20 MB per file. Generated or
sensitive content such as `.git`, `node_modules`, build directories, and `.env`
files is excluded. Empty directories, symbolic links, and executable permission
bits are not preserved by browser folder uploads.

## Exporting a project

Open a project and select **Export** to download it as a Cortex `.ctx` file.
A `.ctx` file is a standard ZIP archive whose root contains the project files,
so it can be inspected or extracted with regular ZIP tools on Windows, Linux,
and macOS.

Exports also carry a validated execution graph in `.cortex/workflow.json` when
one has been determined for the current instructions. Import restores that graph
under the new project ID, including independent entry points and aggregation,
and remaps agent IDs when converting engines. This metadata is kept in Cortex's
configuration, without editing project instructions. Sessions, parameter values
and schedules are not transferred. An older archive without this metadata still
requires workflow analysis on its destination machine. If analysis fails, Cortex
reports an error instead of executing a guessed sequence based on filenames.

Exports use the same exclusions and limits as imports. Generated directories,
environment secrets, common credential files, private keys, audit databases and
transaction backups are excluded. Symbolic links and nonportable paths are
rejected. The complete archive is checked before the download starts, including
the 100 MB archive limit. This is a filename-based policy; review project content
before sharing an archive. An export is prepared in memory and may temporarily
use approximately 200 MB plus buffers at the maximum allowed size.

## Editing and saving

In the editor, **Project review** opens a conversation where you can describe
desired changes, ask questions, or request a general analysis. Follow-up messages
include the previous exchanges and the current unsaved draft. Closing and
reopening the review keeps the conversation while the editor remains open;
leaving the editor or reloading the page clears it. Recommendations link to the
relevant agents or instructions. The review also prepares concrete proposals to
update global instructions, edit agent settings, or add and remove agents.
Expand **View changes** to compare the full before/after content. **Apply and
save** approves that exact proposal and saves it together with the current
editor draft, keeping the discussion open. You can decline or refine a proposal;
editing the draft makes an older proposal unavailable until it is updated.

Unsaved editor drafts are kept in the current browser, separately for each
project. Reopening the editor offers **Restore draft** or **Delete draft**.
Navigation and reload warn before leaving a modified draft. Saving or explicitly
discarding changes removes the saved draft. If browser storage is unavailable,
the editor reports that draft recovery is unavailable.

Configuration mutations are serialized within the server process and written
using an atomic file replacement. Run only one Cortex server per configuration
file. Project edits validate and stage all changed files before applying them;
an ordinary write or rename failure restores the previous files. If the server
stops mid-save or rollback fails, a sibling `.cortex-edit-*` directory retains
backups and a `recovery.json` manifest for manual recovery. This does not provide
an automatic recovery guarantee for a power failure during a multi-file save.

## Scheduled workflows

From a project's **Workflow** tab, select **Schedule** to configure one or more
standard five-field cron expressions (`minute hour day-of-month month day-of-week`).
Use **Add a run time**, select a run time to edit its frequency or custom cron,
and use its delete button to remove it. At least one run time must remain.
All run times share the selected timezone, enabled setting and workflow parameters.
The dialog previews the next three occurrences of the selected run time; every
expression must be valid before the complete list can be saved. The next scheduled
run is the earliest matching occurrence across all expressions. Overlapping or
duplicate expressions trigger only one execution per project and UTC minute.
Existing single-expression configurations remain supported. The API accepts a
`crons` array alongside the legacy `cron` field, which mirrors the first expression.
An older client updating only `cron` preserves the additional expressions.
The schedule remains active when the browser is
closed, as long as the Cortex server is running. Each occurrence starts a fresh
workflow and automatically passes the selected branch results to downstream
agents. An occurrence is skipped when the same project is already running.

Occurrences are claimed in SQLite using the project and scheduled UTC minute.
Saving the schedule again or restarting Cortex in the same minute does not
execute that occurrence twice. Missed minutes while the server was offline are
not replayed automatically. An unfinished occurrence is marked interrupted on
restart; the last recorded scheduling result remains available.

## Durable asynchronous workflows

An agent can suspend a request until an external event, a timer, or a final deadline.
Cortex checkpoints the request in SQLite and releases the provider session and
execution slot. Independent branches continue; dependent steps wait for the
suspended agent's final response. A server-side worker resumes sleeping requests,
including after a server restart, without keeping the browser open.

Describe the wait in the agent's instructions: the expected result, correlation
key, checking interval, final deadline, permitted replies and reminder limit.
Cortex includes the structured response contract in the prompt. The agent returns
`status: "waiting"`, `nextAgentIds: []`, and a `wait` object:

| Field | Meaning |
| --- | --- |
| `reason` | Short explanation shown in the workflow |
| `eventKey` | Correlation key, such as `hotel:booking-123`, or null for a timer |
| `wakeAfterSeconds` | Positive delay before the next check, or null for event-only waiting |
| `deadlineAt` | Absolute ISO 8601 deadline with timezone, in the future and within one year |
| `state` | Saved business context (string, up to 32000 characters): completed actions, message IDs, reminder count, outstanding work |

At least an event key or a timer is required. The final deadline is mandatory and
cannot be extended by a resumed wait. The wake identifies its cause (`event`,
`timer`, or `deadline`) and includes the saved business context. After the final
deadline, the agent must conclude or route to a terminal result; another wait is
rejected. The workflow execution budget applies across all automatic wakes.
Checking for replies and sending reminders must have distinct policies in the task.

The workflow displays its waits and deadlines. **Provide a reply** submits a local
event for testing or human input. **Stop** cancels the request and its automatic
wakes. **Reset** starts a separate request with a new instance ID. This first
version retains **one active workflow instance per project**, with multiple
independent waiting threads inside it; separate projects can wait concurrently.
Cron occurrences skip a project while it is waiting.

For a connector, obtain `workflowInstance.id` from `GET /api/agents/projects/:id`
and submit `POST /api/agents/projects/:id/workflow/events` with JSON:

```json
{
  "instanceId": "the-current-instance-id",
  "id": "provider-message-id",
  "key": "hotel:booking-123",
  "payload": "Your booking is confirmed. Reference HOTEL-123."
}
```

The endpoint uses the application's existing authentication. It durably queues
events even before the matching wait is registered. Repeating the same event ID
and content is acknowledged without reprocessing; conflicting reuse is rejected.
Events are scoped to an instance so old messages cannot resume a new reservation.
Each event is delivered to one matching waiting thread. Use separate correlation
keys for independent conversations. An event received before the deadline can
still be processed after a server outage; one received after it cannot turn an
expired wait into a confirmation.

Run `node --import tsx scripts/create-async-demo.mts` to create the real Cortex
project **Reservation hotel - asynchrone**. It uses two Codex agents and simulated
hotel messages. Start the first agent, observe its timer wake, then provide a
confirmation or an unavailability reply. No real email is sent. The script is
idempotent and prints the project URL; its agents explicitly select GPT-5.5.

Gmail can be connected separately using the Gmail panel described below. Other
connectors can check messages without calling the model and deliver relevant
events to this endpoint. Cortex cannot guarantee exactly-once external side effects.
Interrupted/failed active steps require explicit **Resume workflow**; only cleanly
suspended requests resume automatically. The saved provider session must remain
accessible. Run one Cortex server per database. Project edits invalidate the
current checkpoint and cancel the old automatic waits.

### Connect your Gmail mailbox

If Gmail is already connected through the Codex Gmail plugin, workflows can use
that existing connection directly. The agent calls Gmail, saves the query/thread
and processed message IDs in `wait.state`, then returns a timer-based durable wait.
On wake it checks the same conversation again using the existing plugin. This
mode needs no separate Google client; each check runs an agent, so select a suitable
interval and fixed final deadline. Existing authorized send scripts can also be
used where installed, within the workflow's explicit sending instructions.

Run `node --import tsx scripts/create-gmail-demo.mts` for a real, read-only plugin
test: two Gmail checks separated by a durable 15-second wait. It sends no mail.
The `--refresh` option updates this demo through the running local Cortex API.

The **Gmail** panel in a project's Agents tab connects Cortex directly to Google;
the Gmail connection in the Codex conversation is not inherited by this server.

1. In Google Cloud, enable Gmail API, configure OAuth consent and add your email
   as a test user if the application is in testing. Create a **Desktop app** OAuth
   client and download its JSON credentials.
2. Open Cortex at `http://127.0.0.1:3000`, expand **Gmail**, import that JSON, then
   choose **Connect Gmail** and grant read and send access in Google's browser flow.
   A Web application client also works when its authorized redirect URI exactly
   matches `http://127.0.0.1:3000/api/gmail/callback`.
3. Start a workflow that returns a durable wait with an event key. Search for the
   relevant Gmail conversation, select that wait, and choose **Watch for new replies**.
   Existing messages form the baseline and are not injected into the workflow.
4. New incoming messages in this thread are checked every 30 seconds without a
   model call. A matching reply becomes a durable workflow event. The subscription
   survives server restart and stops when the instance ends, is reset or cancelled.
   Failed/interrupted instances pause the subscription until explicit recovery.

The panel also lets the user compose and explicitly send a real plain-text email,
then associate its thread with an active wait. It does not authorize model-driven
outbound replies or reminders: those require a separately defined sending policy.
An uncertain send remains blocked from automatic retry; check Gmail's Sent folder
before composing another message. The current composer starts new conversations.
Incoming attachments are not read; text is limited to 4,000 characters and HTML is
converted to text. Missing details must be verified before concluding a request.

OAuth credentials, refresh tokens, subscriptions and send receipts are local in
`data/gmail/connection.sqlite`, outside Git and project exports. This file contains
secrets and message content; restrict OS access and protect backups. POSIX file
permissions are restricted; on Windows, access follows the containing folder's ACL.
Tokens are renewed automatically, but revoked or expired Google authorization
requires reconnecting. **Disconnect Gmail** removes local tokens and watches and
attempts to revoke the Google grant. One mailbox is shared by the local Cortex
server's projects; use Cortex password authentication when exposing the server.

For HTTPS hosting, set `CORTEX_GMAIL_REDIRECT_URI` to the exact public callback URL
and register that URL in a Google Web client. The Gmail panel must be opened from
that same origin. OAuth uses state, a browser-bound HttpOnly cookie and PKCE.
Google setup reference: https://developers.google.com/identity/protocols/oauth2/native-app

## Execution progress and recovery

Running agents show elapsed time, time since the last engine event and a bounded
live response preview. **Stop** cancels the project's active executions. Completed
instances are retained; retrying a failed agent runs only the incomplete
instances. Stopping an execution does not undo changes already made by its tools.

SQLite checkpoints retain completed responses, session IDs, parameters and
incomplete instances. After a restart, **Resume workflow** continues from that
checkpoint only when the project definition is unchanged. Recovery requires an
explicit action; the server never resumes interrupted work automatically. The
engine must still be able to access any saved session. A reset or project edit
invalidates the checkpoint.

Codex terminal `turn.failed` and `error` events provide the displayed failure;
older tool diagnostics from stderr do not replace that cause. A model capacity
failure gets at most two retries, after 5 and 15 seconds, using the same model
and the same durable mission conversation to reconcile and finish existing
work. Read-only interpretation may retry in a fresh isolated session. Other
failures and business turns without a durable session are not replayed.
Cancellation also interrupts the retry wait. Streamed mission session IDs are
saved on failure so explicit recovery can continue them after a server restart.

Automatic workflows follow selected branches and loops until completion, with
a default maximum of 100 agent executions per run. Each agent launch executes at
most four instances concurrently. Agent engine executions have no time limit and
continue until they finish, fail, or are explicitly stopped. The concurrency and
workflow execution-count limits are configurable using the variables below.
`CORTEX_AGENT_TIMEOUT_MS` is no longer used. Short operational checks (engine
discovery, connection setup and cleanup) retain their own timeouts.

Independent ready agents run concurrently, sharing the workflow's instance
concurrency limit. A convergence waits for all applicable branches before
combining their results. In manual mode, a project with multiple entry points
can start them together while preserving each agent's manual/automatic setting
and additional instructions.

## Workflow parameters

For multi-agent projects, Cortex analyzes the project instructions and agent
definitions together with the execution graph to identify the information that
must be supplied before the workflow starts. The **Workflow parameters** panel
lists required and optional values, blocks root agents until all required
values are complete, and passes the validated context to every new agent
session. Values are locked once execution begins and can be edited again after
resetting the workflow.

Scheduled workflows store their validated parameter values in the local Cortex
configuration so they can run while the browser is closed. Parameters must
never be used for passwords, API keys, tokens, or other secrets.

## Workflow audit history

History dates use the browser's local timezone, shown above the history, with
the UTC offset applicable to each event (including daylight-saving changes).
Hovering a date shows the original UTC timestamp; JSON exports retain UTC.

Agent prompts include both local and UTC time for the same instant. Set
`CORTEX_TIMEZONE=Europe/Paris` on a UTC-hosted server to give agents the intended
local date and time. It defaults to the server's timezone and is validated at
startup. This setting does not change cron schedules: each schedule retains its
own explicitly selected timezone. A `04:00 UTC` schedule runs at `06:00` in Paris
in summer and `05:00` in winter; a `04:00 Europe/Paris` schedule stays at `04:00`
in Paris throughout the year.

The **History** tab records manual and scheduled workflow runs in a local
SQLite database. Each run includes its trigger, parameters, timestamps, status,
and every agent thread. Agent details contain the upstream data, additional
instructions, exact effective prompt sent to the engine, raw response, selected
branches, session ID, model, reasoning effort, duration, and error when present.

The database is stored in `data/audit/cortex-audit.sqlite` by default and is
excluded from project archives and version control. Set
`CORTEX_AUDIT_DATABASE` to an alternate file path when the audit data must live
on a dedicated or backed-up volume. Because prompts and responses can contain
sensitive project data, protect the Cortex server with authentication whenever
it is reachable outside the local machine.

## MCP connections

The engine settings panel discovers MCP servers configured for Codex, Claude,
and GitHub Copilot. When a project is active, it also includes project-scoped
servers. Cortex reads these files without modifying them:

- Codex: `~/.codex/config.toml` and `.codex/config.toml`;
- Claude: `~/.claude.json` and `.mcp.json`;
- Copilot: `~/.copilot/mcp-config.json`, `.mcp.json`, and `.github/mcp.json`.

Codex and Claude load their native configuration through their CLI. Copilot is
run through its SDK, so Cortex supplies the user MCP servers to each session and
enables project configuration discovery. OAuth tokens remain in each engine's
native credential store and are never returned by the Cortex API.

`CODEX_HOME` and `COPILOT_HOME` change the corresponding user configuration
directory. `CORTEX_COPILOT_MCP_CONFIG` and `CORTEX_CLAUDE_MCP_CONFIG` can point
to a specific MCP configuration file when a non-standard layout is required.

## Quality checks

```bash
npm run check
```

This command runs strict TypeScript type checking, all Node.js tests, and the production build. It is also run by CI for every pull request.

To run the complete browser campaign after installing Chromium:

```bash
npx playwright install chromium
npm run check:all
```

CI runs both checks on Windows and Linux. The browser suite uses the production
HTTP application with a simulated engine and temporary storage: it never invokes
an installed AI engine or accesses your saved projects. It covers creation,
editing, draft recovery, browser navigation, cancellation/retry, audit and archive
import at widths 390, 700, 980 and 1440 px. It also checks accessibility and keeps
screenshots and failure traces in `playwright-report/` and `test-results/`.
See the [Playwright server setup](https://playwright.dev/docs/test-webserver) and
[accessibility testing](https://playwright.dev/docs/accessibility-testing) documentation.

## Server configuration

| Variable | Default value | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server listening interface |
| `PORT` | `3000` | HTTP port, between 1 and 65535 |
| `CORTEX_PASSWORD` | none | Optional access password, at least 12 characters when set |
| `CORTEX_SECURE_COOKIE` | `false` | Set to `true` when Cortex is served over HTTPS |
| `CORTEX_PROJECTS_DIRECTORY` | `<workspace>/projects` | Directory used to store projects uploaded through the browser |
| `CORTEX_AUDIT_DATABASE` | `<workspace>/data/audit/cortex-audit.sqlite` | SQLite file used for persistent workflow audit history |
| `CORTEX_TIMEZONE` | server timezone | IANA timezone for local date/time context sent to agents; independent of each cron's timezone |
| `CORTEX_MAX_CONCURRENT_INSTANCES` | `4` | Maximum concurrent instances within an agent launch |
| `CORTEX_MAX_WORKFLOW_EXECUTIONS` | `100` | Maximum agent executions in one automatic workflow, including loop iterations |
| `CORTEX_COPILOT_MCP_CONFIG` | `<COPILOT_HOME>/mcp-config.json` | Optional Copilot MCP configuration file override |
| `CORTEX_CLAUDE_MCP_CONFIG` | `~/.claude.json` | Optional Claude MCP configuration file override |

The server intentionally listens locally by default: its routes can read and modify projects on the machine and must not be exposed publicly without additional authentication and access controls.
The password protects the application, but remote deployments must still use HTTPS so that credentials and session cookies are encrypted in transit.

## Project structure

- `src/front`: React application and API client;
- `src/back/application`: use cases, services, and agent providers;
- `src/back/infrastructure`: Express HTTP server;
- `src/shared`: shared contracts and algorithms;
- `docs`: manual acceptance test campaigns.

## Work Light

**Work Light** runs one selected agent at each cron occurrence. Choose existing
agents from the sidebar, drag them into order, then configure one or more advanced
cron rules and an IANA time zone (Europe/Paris by default). Enable the mode after
saving. For A/B/C at 12:00 and 20:00, the rotation is A, B, C, A across days.
Completion does not trigger the next agent: it waits for the next slot.

Each slot with sufficient quota joins the global execution queue. An occupied
serial queue or the same agent already running delays execution beyond the slot;
later slots still enqueue their own next agents. Different agents can overlap
when simultaneous executions are enabled. Insufficient/unknown quota skips the
slot and retains the next agent. Quotas are checked again after queue waits; a
refused launch releases its turn. The default minimum reserves are 30% over five
hours and 8% weekly, editable separately under Settings → General → Work Light
or on its page. Status and preview reads do not query quotas or invoke a model.

The cursor advances when an occurrence reserves its agent, so pending slots
rotate through the selection. Refused or cancelled requests restore the next
agent to retry. Failures, external waits and interrupted runs pause for review.
Configuration, cursor and minute claims persist across
restarts; offline slots and the startup minute are skipped. Coincident cron rules
share one absolute UTC-minute claim, including daylight-saving transitions.
Activation starts from the next future slot; stopping cancels pending requests
and lets already running agents finish. Pending requests are marked interrupted
after a server restart and are not silently replayed.
Reordering while stopped preserves the next agent by identity when still selected.

Work Force, Work Light, normal schedules, automatic dossiers, workflow wakeups
and chats/prompts share the global concurrency rules. The sidebar button turns
red while Work Light is active.
The server must stay running and its clock must be synchronized for timely slots.

API: /api/work-light with /status, /agents, /configuration, /settings, /preview,
/start and /stop. Editing the list/schedule requires a stopped mode. Histories of
the last 20 executions and 40 evaluated slots are visible on the Work Light page.
