# Cortex

Cortex is a local application for creating, visualizing, and running Codex, Claude, or GitHub Copilot agent workflows. The React frontend is served by an Express API that reads agent configurations directly from saved projects.

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
relevant agents or instructions, and edits remain under your control.

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

From a project's **Workflow** tab, select **Schedule** to configure a standard
five-field cron expression (`minute hour day-of-month month day-of-week`). The
schedule uses the server's local timezone and remains active when the browser is
closed, as long as the Cortex server is running. Each occurrence starts a fresh
workflow and automatically passes the selected branch results to downstream
agents. An occurrence is skipped when the same project is already running.

Occurrences are claimed in SQLite using the project and scheduled UTC minute.
Saving the schedule again or restarting Cortex in the same minute does not
execute that occurrence twice. Missed minutes while the server was offline are
not replayed automatically. An unfinished occurrence is marked interrupted on
restart; the last recorded scheduling result remains available.

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

Automatic workflows follow selected branches and loops until completion, with
a default maximum of 100 agent executions per run. Each agent launch executes at
most four instances concurrently. Engine executions have a default 15-minute
timeout. These limits are configurable using the variables below.

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
| `CORTEX_AGENT_TIMEOUT_MS` | `900000` | Maximum engine execution time in milliseconds |
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
