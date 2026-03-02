# visudev

Preview Runner for [VisuDEV](https://github.com/iamthamanic/Visudevfigma): clone repo, build and run the app, expose a URL for the Live App / AppFlow view.

## Quick start

```bash
npx visudev-runner
```

Starts the runner on port 4000 (override with `PORT=4001 npx visudev-runner`).

## AppFlow

- **Local:** Run the VisuDEV app with `npm run dev` (in the repo). In dev mode the app uses `http://localhost:4000` by default. Start the runner in another terminal: `npx visudev-runner`. AppFlow will use it.
- **Deployed app:** Set `PREVIEW_RUNNER_URL` in Supabase (Edge Function secrets) to the runner’s public URL (e.g. `https://your-runner.example.com`). Run the runner on that server with `npx visudev-runner`.

## Env (optional)

- `PORT` – API port (default 4000)
- `USE_REAL_BUILD=1` – clone, build and run the app (default stub)
- `USE_LOCAL_WORKSPACE` – absolute path (or path relative to cwd) to use as workspace instead of cloning; skips Git clone/pull so the preview runs your current local code (handy for AppFlow so each iframe card shows the correct tab)
- `USE_DOCKER=1` – run each preview in a container
- `PREVIEW_CLEAN_BEFORE_BUILD=0` – disable cleaning of `dist`, `.next`, `out`, `.vite`, `node_modules/.cache` before each Docker build (default: clean enabled to avoid stale artifacts)
- `PREVIEW_DOCKER_READY_TIMEOUT_MS` – wait timeout for Docker app startup (default `300000`)
- `PREVIEW_DOCKER_LOG_TAIL` – number of Docker log lines in diagnostics (default `120`)
- `GITHUB_TOKEN` – for private repos
- `GITHUB_WEBHOOK_SECRET` – for webhook signature verification

## API

- `POST /start` – start a preview (body: `repo`, `branchOrCommit`, `projectId`)
- `GET /status/:runId` – status and `previewUrl`
- `POST /stop/:runId` – stop and free port
- `POST /stop-project/:projectId` – stop all runs for one project

**Security:** All access to runs is enforced server-side. `GET /status/:runId`, `POST /stop/:runId`, and `POST /stop-project/:projectId` require the `x-visudev-project-token` header (issued on `/start`); invalid or missing token returns 401/403. Write endpoints are rate-limited per client IP (env: `RUNNER_WRITE_RATE_LIMIT_WINDOW_MS`, `RUNNER_WRITE_RATE_LIMIT_MAX`).

- `POST /refresh` – pull, rebuild, restart for a run
- `GET /health` – health check
- `GET /runs` – active runs, projects and runner uptime

Later this package will grow into the full local VisuDEV stack (`npx visudev`).
