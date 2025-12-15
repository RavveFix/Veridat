# Britta Roadmap

Updated: 2025-12-12  
Detailed engineering backlog lives in `.claude/IMPROVEMENTS.md`. This file is a **high‑level product/engineering roadmap**.

## Status Legend

- ✅ **Built** — shipped in main
- 🛠️ **In progress** — active work
- ☕ **Planned** — not started yet

---

## 0–1 Months (v1 hardening + cloud persistence)

Core work to finish v1 and move key data to Supabase.

- 🛠️ **Supabase persistence for company data**
  - Add migrations for: `companies`, `bookkeeping_entries`, `supplier_invoices`, `company_documents`
  - Migrate from localStorage → Supabase (with safe backfill)
  - See `docs/architecture/supabase-schema.md` for proposed schema

- ☕ **Production frontend deployment**
  - Ship Vercel build + env wiring (`VITE_SUPABASE_*`)
  - Verify PWA install + auth flow in prod

- ☕ **Security baseline**
  - Restrict CORS in all Edge Functions (`SEC-001`)
  - Add input validation for org.nr, period, file size (`SEC-003`)
  - Fortnox authorization checks (`SEC-004`)

- ☕ **E2E smoke tests**
  - Playwright flow: Upload Excel → VAT report → saved to chat (`TEST-004`)

---

## 1–3 Months (feature expansion)

Features that extend existing capabilities without major infra changes.

- ☕ **Fortnox real OAuth flow** (`FEAT-001`)
  - Replace mock tokens with full user OAuth + refresh rotation

- ☕ **SIE export** (`FEAT-002`)
  - Export VAT/journal entries to SIE from momsrapport UI

- ☕ **PWA offline support** (`FEAT-003`)
  - Add service worker + caching strategy
  - Optional IndexedDB “outbox” for offline edits → Supabase sync

- ☕ **PDF VAT report generation** (`FEAT-004`)
  - Generate a shareable PDF of momsrapport

- ☕ **Test coverage upgrades**
  - Frontend unit tests (Vitest) (`TEST-001`)
  - Edge Function integration tests (Deno) (`TEST-002`)
  - Python VAT/excel service tests (`TEST-003`)

---

## 3–6 Months (performance + platform foundations)

Advanced improvements requiring more coordination or infra.

- ☕ **IP‑based rate limiting** (`SEC-002`)
- ☕ **Database/query optimization** (`PERF-003`)
- ☕ **Vite shared chunks + bundle analysis** (`PERF-002`, `DEV-003`)
- ☕ **State management cleanup** (`ARCH-002`)

---

## 6+ Months / Future

Major initiatives and platform‑defining work.

- ☕ **Dependency injection pattern** (`ARCH-001`)
- ☕ **Shared validation schemas across layers** (`ARCH-003`)
- ☕ **Team / multi‑user collaboration**
  - Roles per company, shared conversations, audit trails
  - Requires deeper auth + permission model

---

## Feature Template

Use this when adding new roadmap items.

```
▶ [Feature Name] — [✅ Built / 🛠️ In progress / ☕ Planned]

Time Estimate: X weeks/months

Description:
- What it does and for whom

Why it’s not in v1:
- Constraints, dependencies, or scope

Current State:
- What’s already built?
- What needs to be completed?

Integration Steps:
1. Step 1
2. Step 2
3. Step 3

Dependencies:
- Other features/systems required first
```
