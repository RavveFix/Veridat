# Repository Guidelines

## Project Structure & Module Organization

- `veridat/src/`: Next.js frontend (App Router, TypeScript).
- `shared/`: Shared constants used by tests and tooling.
- `supabase/functions/`: Deno Edge Functions (e.g., `gemini-chat`, `analyze-excel-ai`, `fortnox`, `python-proxy`).
- `python-api/`: FastAPI VAT service (Railway deploy target).
- `tests/`: lightweight frontend verification scripts; `python-api/tests/`: pytest suite.
- `veridat/.next/`: Next.js build output (gitignored).

## Build, Test, and Development Commands

- `npm run dev`: start Next.js dev server (proxies to `veridat/`).
- `npm run build`: production build (proxies to `veridat/`).
- `npm run preview`: serve the production build locally (proxies to `veridat/`).
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
- Next.js App Router: add new UI as `.tsx` components under `veridat/src/`.
- Naming: `PascalCase` for components/classes (`ChatService.ts`), `camelCase` for functions/vars.

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
