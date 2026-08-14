# Cortex

Cortex is a local application for creating, visualizing, and running Codex, Claude, or GitHub Copilot agent workflows. The React frontend is served by an Express API that reads agent configurations directly from saved projects.

## Prerequisites

- Node.js 20.19 or later, or Node.js 22.12 and later;
- npm;
- at least one supported engine installed and authenticated (`codex`, `claude`, or GitHub Copilot).

## Getting started

```bash
npm ci
npm start
```

The application is then available at <http://127.0.0.1:3000>. The local `config.json` file is created on the first save and is not committed to version control. Its structure is documented in `config.example.json`.

For development with hot reload, use two terminals:

```bash
npm run dev
npm run dev:web
```

Vite serves the frontend and proxies `/api` to the Express server.

## Scheduled workflows

From a project's **Workflow** tab, select **Schedule** to configure a standard
five-field cron expression (`minute hour day-of-month month day-of-week`). The
schedule uses the server's local timezone and remains active when the browser is
closed, as long as the Cortex server is running. Each occurrence starts a fresh
workflow and automatically passes the selected branch results to downstream
agents. An occurrence is skipped when the same project is already running.

## Quality checks

```bash
npm run check
```

This command runs strict TypeScript type checking, all Node.js tests, and the production build. It is also run by CI for every pull request.

## Server configuration

| Variable | Default value | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server listening interface |
| `PORT` | `3000` | HTTP port, between 1 and 65535 |

The server intentionally listens locally by default: its routes can read and modify projects on the machine and must not be exposed publicly without additional authentication and access controls.

## Project structure

- `src/front`: React application and API client;
- `src/back/application`: use cases, services, and agent providers;
- `src/back/infrastructure`: Express HTTP server;
- `src/shared`: shared contracts and algorithms;
- `docs`: manual acceptance test campaigns.
