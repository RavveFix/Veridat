# Repository Guidelines

## Project Structure & Module Organization

- `apps/web/src/`: frontend TypeScript (controllers, services, hooks, components, styles, utils).
- `apps/web/app/`: main app HTML + PWA assets (`apps/web/app/index.html`, `apps/web/app/manifest.json`).
- `apps/web/*.html`: top-level pages (`apps/web/index.html`, `apps/web/login.html`, `apps/web/privacy.html`, `apps/web/terms.html`).
- `supabase/functions/`: Deno Edge Functions (e.g., `gemini-chat`, `analyze-excel-ai`, `fortnox`, `python-proxy`).
- `python-api/`: FastAPI VAT service (Railway deploy target).
- `tests/`: lightweight frontend verification scripts; `python-api/tests/`: pytest suite.
- `dist/`: production build output (generated at repo root).

## Build, Test, and Development Commands

- `npm run dev`: start Vite dev server on `http://localhost:5173` (route rewrites in `vite.config.ts`).
- `npm run build`: TypeScript typecheck (`tsc`) + production bundle to `dist/`.
- `npm run preview`: serve the production build locally.
- `npm run supabase:start` / `npm run supabase:stop`: start/stop local Supabase.
- `npm run supabase:serve`: serve `gemini-chat` locally; `npm run supabase:deploy`: deploy it.
- `cd python-api && uvicorn app.main:app --reload --port 8080`: run the VAT API locally.
- `cd python-api && pytest tests/ -v`: run Python unit tests.

Optional: Claude Code helpers live in `.claude/commands/` (`/dev-start`, `/dev-status`, `/dev-stop`).

## Local Supabase (Docker) Workflow

- Start Docker Desktop and wait for **Engine running**.
- Run `supabase start` from the repo root (first run pulls images and can take a while).
- Generate local env overrides: `npm run supabase:setup` (writes `.env.local` with local keys).
- Start the app: `npm run dev`.
- Verify: `supabase status` (should show local URLs) and `docker ps` (should list `supabase-*` containers).
- Stop locally when done: `supabase stop`.

Notes:
- Local Supabase does **not** affect the cloud project unless you run remote commands (e.g., `supabase link`, `supabase db push`, `supabase functions deploy`).
- Frontend reads `VITE_SUPABASE_*`; `.env.local` is the preferred local override.

## Coding Style & Naming Conventions

- TypeScript is `strict`; prefer explicit types and `async/await`. Avoid `any`.
- Indentation: 4 spaces (match existing files).
- Preact-first UI: add new UI as `.tsx` components under `apps/web/src/components/`; keep imperative DOM “glue” minimal.
- Naming: `PascalCase` for components/classes (`ChatService.ts`), `camelCase` for functions/vars, `kebab-case` for component CSS in `apps/web/src/styles/components/`.

## Testing Guidelines

- Python: pytest in `python-api/tests/` (`test_*.py`). Run via `cd python-api && pytest tests/ -v`.
- Frontend: tests live under `tests/` (see `tests/README.md` for conventions and naming).
- E2E: Playwright in `tests/e2e/`. Start local Supabase + app, then run `npm run test:e2e`.
  - First time: `npx playwright install`.

## Commit & Pull Request Guidelines

- Use the repo’s Conventional-Commit style (examples from history): `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`.
- PRs: include a clear description, link relevant issues, add screenshots for UI changes, and list validation steps (at minimum `npm run build`; run `pytest` when touching `python-api/`).

## Security & Configuration Tips

- Never commit secrets. Use `.env.example` as the template and keep real values in `.env` (ignored).
- Frontend env vars must be `VITE_`-prefixed; API keys belong in Supabase secrets/Edge Functions, not in the browser.
