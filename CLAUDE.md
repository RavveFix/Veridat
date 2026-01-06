# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Britta** is an AI-powered Swedish bookkeeping assistant for small businesses. It's a Progressive Web App (PWA) that helps users with accounting tasks, invoice creation, and tax document analysis.

**Tech Stack:**
- Frontend: Vite + TypeScript (vanilla, class-based components)
- Backend: Supabase Edge Functions (Deno)
- AI: Google Gemini (chat/PDF), OpenAI (column mapping), Claude (fallback)
- Integrations: Fortnox API for accounting operations
- Database: Supabase PostgreSQL with RLS

---

## Quick Start

```bash
# Start all services (recommended)
/dev-start

# Or manually:
npm run dev               # Frontend (Vite :5173)
npm run supabase:start    # Supabase services

# Check status
/dev-status

# Stop all
/dev-stop
```

---

## Documentation Modules

Detailed documentation is split into focused modules:

| Module | Purpose |
|--------|---------|
| [Architecture](.claude/docs/01-architecture.md) | Service layer, file routing, Edge Functions, database |
| [Development](.claude/docs/02-development.md) | Local setup, commands, testing |
| [Deployment](.claude/docs/03-deployment.md) | Railway, Supabase, Vercel workflows |
| [Security](.claude/docs/04-security.md) | CORS, RLS, rate limiting, secrets |
| [Testing](.claude/docs/05-testing.md) | Unit tests, API verification, E2E |
| [Debugging](.claude/docs/06-debugging.md) | Common issues, troubleshooting |
| [Swedish Accounting](.claude/docs/07-swedish-accounting.md) | VAT, BAS accounts, SIE files |

---

## Key Architecture

### Intelligent File Routing
```
Excel (.xlsx, .xls) → analyze-excel-ai
                        ├── Monta file? → Deterministic parser (100% accuracy)
                        └── Other file? → Claude AI analysis

PDF/Images → gemini-chat → Gemini AI
Text → gemini-chat → Gemini AI
```

### Edge Functions
- `gemini-chat` - Main chat, PDF analysis
- `analyze-excel-ai` - Excel analysis (Monta: deterministic, Other: OpenAI mapping)
- `fortnox` - Accounting operations

### Services
- `GeminiService` - AI interactions
- `FortnoxService` - Fortnox API
- `RateLimiterService` - Usage limits (10/hour, 50/day)
- `SwedishRounding` - Öresavrundning (ROUND_HALF_UP)
- `SwedishValidation` - Org.nr/VAT validering (Luhn)
- `ZeroVATValidator` - ML 3:30a compliance
- `BASAccounts` - Kontoplan + intelligent routing
- `JournalService` - Verifikations-ID (BFL 7:1) + journalposter

---

## Environment Variables

### Supabase Secrets
```bash
supabase secrets set GEMINI_API_KEY=...
supabase secrets set OPENAI_API_KEY=...  # For column mapping
supabase secrets set FORTNOX_CLIENT_ID=...
supabase secrets set FORTNOX_CLIENT_SECRET=...
```

### Frontend (.env)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## Skills

### svensk-ekonomi (`.skills/svensk-ekonomi/`)
Swedish accounting expertise:
- VAT/moms (25%, 12%, 6%, 0%)
- BAS account plan
- SIE file export
- Org.nr/VAT validation
- EV charging accounting

```bash
python3 .skills/svensk-ekonomi/scripts/validators.py org 5561839191
python3 .skills/svensk-ekonomi/scripts/vat_processor.py input.xlsx --output report.json
```

---

## Agents

Custom agents for specialized workflows:

| Agent | Purpose |
|-------|---------|
| [VAT Calculator](.claude/agents/vat-calculator.md) | Excel → Edge Function routing |
| [PR Reviewer](.claude/agents/pr-reviewer.md) | Security checks, architectural patterns |
| [Deployment](.claude/agents/deployment.md) | Multi-service deployment orchestration |

---

## Commands

Development workflow commands:

| Command | Purpose |
|---------|---------|
| `/dev-start` | Start all local services |
| `/dev-stop` | Stop all services |
| `/dev-status` | Check service status |

---

## Important Notes

- Swedish language for all user-facing content
- BAS account plan for bookkeeping
- LocalStorage for frontend data (no Supabase auth yet)
- Rate limiting defaults to 'anonymous' for unauthenticated users

---

## Current Status

- [x] Edge Functions deployed (Supabase)
- [x] Security fixes (CORS, timing attacks)
- [x] **Supabase Realtime Sync** (live chat updates)
- [x] **Monta Deterministic Parser** (100% accuracy for EV charging)
- [x] **Swedish Accounting Services** (öresavrundning, BAS-konton, journalposter)
- [x] **Zero VAT Validation** (ML 3:30a compliance)
- [x] **Python API removed** (all logic now in Edge Functions)
- [ ] Production frontend (Vercel)
- [ ] E2E testing

---

## Features

### Realtime Sync
Live updates across browser tabs using Supabase Realtime:
- **ChatHistory** - New messages appear instantly via `postgres_changes` subscription
- **ConversationList** - Sidebar updates on conversation create/update/delete

```typescript
// Example: Subscribe to new messages
supabase
    .channel(`messages:${conversationId}`)
    .on('postgres_changes', { event: 'INSERT', table: 'messages' }, callback)
    .subscribe();
```

### Monta EV Charging Parser

Deterministic parser for Monta transaction exports - **no AI guessing, 100% accuracy**.

**Detection:** File has columns `amount`, `subAmount`, `vat`, and `roamingOperator`/`kwh`

**Transaction Categories:**
| Type | Detection | VAT | BAS |
|------|-----------|-----|-----|
| Private charging | `amount > 0`, no roaming | 25% | 3010 |
| Roaming export | `amount > 0`, has roaming | 0% | 3011 |
| Subscription | `amount < 0`, ref=SUBSCRIPTION | 25% | 6540 |
| Operator fee | `amount < 0`, note=operator fee | 25% | 6590 |
| Platform fee | `amount < 0`, note=Platform fee | 0% | 6590 |

**Legal basis:** EU C-60/23, OCPI, Swedish ML 5 kap 9§

See [Swedish Accounting](.claude/docs/07-swedish-accounting.md#monta-excel-parser-deterministic) for full documentation.

---

## Session Notes

For session-specific notes, use `.claude/CLAUDE.local.md` (gitignored).

---

*Full backup available in `CLAUDE_BACKUP.md`*
