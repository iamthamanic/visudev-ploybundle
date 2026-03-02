# VisuDEV

Developer tool to visualize deterministic flows from UI elements through code, API, SQL/RLS to backend systems. Screen-centric view with GitHub as source of truth and Supabase as backend.

## Quick start

```bash
npm i
npm run dev
```

Damit starten **VisuDEV-App** (Vite, Port 3005) und **Preview-Runner** (Port 4000) mit **echtem Build** – der Runner klont das Repo, baut und startet die App; in App Flow siehst du die echte Live-App. Ein **Ctrl+C** beendet beide.

Open: **http://localhost:3005** (fester Port, siehe unten). Runner: http://localhost:4000. Sign in or create an account, connect GitHub in **Settings → Connections**, then create or select a project and run analysis (App Flow, Blueprint, Data).

## Scripts

| Command              | Description                                      |
| -------------------- | ------------------------------------------------ |
| `npm run dev`        | Startet App (Vite, 3005) + Preview-Runner (4000) |
| `npm run dev:app`    | Nur Vite-Dev-Server (3005)                       |
| `npm run dev:runner` | Nur Preview-Runner (4000)                        |
| `npm run build`      | Production build                                 |
| `npm run preview`    | Preview production build                         |
| `npm run checks`     | Format, lint, typecheck, tests                   |
| `npm run format`     | Prettier + Deno fmt                              |

## Project layout

- `src/` – Frontend (React, TypeScript, CSS Modules). Modules under `src/modules/` (projects, appflow, blueprint, data, logs, settings, shell).
- `src/supabase/functions/` – Edge Functions source (visudev-auth, visudev-analyzer, visudev-projects, etc.). Deploy with `supabase functions deploy <name>`.
- `supabase/` – Config, migrations, and deployed function copies. See `docs/SUPABASE_SETUP.md`.
- `docs/` – Setup and runbooks (`SUPABASE_SETUP.md`, `GITHUB_SECRETS.md`, `PREVIEW_RUNNER.md`).

## Dev-Server-Port (3005)

Der Vite-Dev-Server und `npm run preview` laufen fest auf **Port 3005** (`vite.config.ts`: `server.port` / `preview.port`). Mit `strictPort: true` bricht Vite ab, wenn 3005 belegt ist – so starten keine weiteren Instanzen auf anderen Ports. Andere Dienste sollten 3005 nicht verwenden, damit VisuDEV immer unter http://localhost:3005 erreichbar ist.

## Configuration

- **Supabase:** The app uses **Supabase Cloud** by default (project ref in code). No `.env` required. For local Supabase, see `docs/SUPABASE_SETUP.md` and `.env.example`.
- **GitHub OAuth:** Configure `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in Supabase Dashboard → Edge Functions → Secrets for the auth function.
- **Live App (Preview):** VisuDEV can build and run the linked app from the repo. See `docs/PREVIEW_RUNNER.md`. Optional: add `visudev.config.json` in your app repo root (`buildCommand`, `startCommand`, `port`) so the Preview Runner builds and serves it correctly.

## Design and scope

- Design: Figma [visudev](https://www.figma.com/design/PtKgTCSh5UDKXJeSQ1WkbG/visudev).
- Scope and comparison to similar tools: `inspiration.md` (dependency/call-graph tools, phased plan).
- Implementation details: `src/IMPLEMENTATION_REPORT.md`, `src/IMPLEMENTATION_DETAILS.md`.
- Open work: `tickets2.md`.

---

Last updated: 2026-03-01 (auto on push).
