# Supabase Schema (Veridat)

This document consolidates the **current Supabase/Postgres schema** in this repo **plus the missing tables required to cover all platform data points**.  
Source of truth for implemented parts is `supabase/migrations/*`. Proposed additions are clearly marked.

---

## 1. Extensions

Required extensions (created in migrations):

- `uuid-ossp` — for `uuid_generate_v4()` (used by `api_usage.id`).
- `pg_trgm` — for fuzzy matching in `expense_patterns`.

---

## 2. Auth & Profiles

### 2.1 `auth.users` (Supabase Auth)

Managed by Supabase. Used as FK target by most user‑scoped tables.

### 2.2 `public.profiles` (implemented)

User‑visible profile and consent tracking.

| Column | Type | Constraints / Default |
|---|---|---|
| `id` | `uuid` | **PK**, FK → `auth.users(id)`, not null |
| `updated_at` | `timestamptz` | nullable |
| `username` | `text` | unique, `char_length(username) >= 3` |
| `full_name` | `text` | nullable |
| `avatar_url` | `text` | nullable |
| `website` | `text` | nullable |
| `has_accepted_terms` | `boolean` | default `false` |
| `terms_accepted_at` | `timestamptz` | nullable |
| `terms_version` | `text` | nullable |
| `consent_email_sent` | `boolean` | default `false` |
| `consent_email_sent_at` | `timestamptz` | nullable |

**Triggers / functions**

- `public.handle_new_user()` + trigger `on_auth_user_created`  
  Auto‑inserts a profile row on signup.

**RLS (enabled)**

- `SELECT`: only own profile (`auth.uid() = id`).
- `INSERT`: only own profile (`auth.uid() = id`).
- `UPDATE`: only own profile (`auth.uid() = id`).
- `ALL`: service role full access.

### 2.3 `public.terms_versions` (implemented)

Audit trail of Terms/Privacy versions.

| Column | Type | Constraints / Default |
|---|---|---|
| `id` | `uuid` | **PK**, default `gen_random_uuid()` |
| `version` | `text` | unique, not null |
| `effective_date` | `timestamptz` | default `now()` |
| `terms_url` | `text` | nullable |
| `privacy_url` | `text` | nullable |
| `change_summary` | `text` | nullable |
| `created_at` | `timestamptz` | default `now()` |

> Note: RLS is not enabled by migrations. If you want this table public‑read‑only, add RLS + select policy for `authenticated`/`anon`.

---

## 3. Integrations & Rate Limiting

### 3.1 `public.fortnox_tokens` (implemented)

Stores OAuth tokens for Fortnox integration.

| Column | Type | Constraints / Default |
|---|---|---|
| `id` | `uuid` | **PK**, default `gen_random_uuid()` |
| `user_id` | `uuid` | FK → `auth.users(id)`, nullable (system token possible) |
| `access_token` | `text` | not null |
| `refresh_token` | `text` | not null |
| `expires_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()` |

**RLS (enabled)**

- `SELECT/UPDATE`: only own rows (`auth.uid() = user_id`).
- No insert policy → only service role inserts/rotates tokens.

### 3.2 `public.api_usage` (implemented)

Rate limiting counters used by Edge Functions.

| Column | Type | Constraints / Default |
|---|---|---|
| `id` | `uuid` | **PK**, default `uuid_generate_v4()` |
| `user_id` | `uuid` | not null (Supabase user) |
| `company_id` | `text` | nullable (local company id) |
| `endpoint` | `text` | not null |
| `request_count` | `int` | default `1` (legacy) |
| `last_reset` | `timestamptz` | default `now()` (legacy) |
| `hourly_count` | `int` | not null, default `0` |
| `daily_count` | `int` | not null, default `0` |
| `hourly_reset` | `timestamptz` | not null, default `now()` |
| `daily_reset` | `timestamptz` | not null, default `now()` |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()` |

**Indexes**

- `idx_api_usage_user_endpoint (user_id, endpoint)`
- `idx_api_usage_last_reset (last_reset)`

**Triggers / functions**

- `public.update_updated_at_column()` + trigger `update_api_usage_updated_at`
- `public.cleanup_old_api_usage()` (optional maintenance)

**RLS (enabled)**

- `SELECT`: only own usage (`auth.uid() = user_id`).
- `ALL`: service role full access.

---

## 4. Files & Storage

### 4.1 `public.files` (implemented)

Excel file metadata for the `excel-files` bucket.

| Column | Type | Constraints / Default |
|---|---|---|
| `id` | `uuid` | **PK**, default `gen_random_uuid()` |
| `filename` | `text` | not null, `char_length(filename) > 0` |
| `storage_path` | `text` | not null, `char_length(storage_path) > 0` |
| `file_size` | `bigint` | not null |
| `mime_type` | `text` | not null |
| `uploaded_at` | `timestamptz` | default `now()` |
| `user_id` | `text` | default `'anonymous'` (stores `auth.users.id` as text) |
| `company_id` | `text` | nullable |

**Indexes**

- `idx_files_user_id (user_id)`
- `idx_files_company_id (company_id)`
- `idx_files_uploaded_at (uploaded_at desc)`

**RLS (enabled)**

- CRUD only for owner (`auth.uid()::text = user_id`).

### 4.2 Storage buckets (implemented)

**`excel-files` bucket**

- Public read enabled in migrations.
- Policies:
  - `SELECT` on `storage.objects` where `bucket_id = 'excel-files'`.
  - `INSERT`/`DELETE` allowed for authenticated users (folder/owner checks in `20251125000002_auth_and_rls.sql`).

**`chat-files` bucket**

- Public bucket created idempotently.
- Policies:
  - Authenticated users can `INSERT`/`SELECT` where `bucket_id = 'chat-files'`.
  - Optional public `SELECT` for debugging.

---

## 5. Chat & AI Memory

### 5.1 `public.conversations` (implemented)

Conversation threads per user/company.

| Column | Type | Constraints / Default |
|---|---|---|
| `id` | `uuid` | **PK**, default `gen_random_uuid()` |
| `user_id` | `uuid` | FK → `auth.users(id)`, not null, cascade delete |
| `company_id` | `text` | nullable (local company id) |
| `title` | `text` | nullable |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()` |

**Indexes**

- `idx_conversations_user_id (user_id)`
- `idx_conversations_company_id (company_id)`
- `idx_conversations_updated_at (updated_at desc)`

**Triggers / functions**

- `public.update_updated_at_column()` + trigger `update_conversations_updated_at` (before update).
- Legacy trigger from earlier migration updates `updated_at` on message insert.
- RPC: `public.get_or_create_conversation(p_user_id uuid, p_company_id text)` → `uuid`.

**RLS (enabled)**

- CRUD only for owner (`auth.uid() = user_id`).

### 5.2 `public.messages` (implemented)

Messages within conversations.

| Column | Type | Constraints / Default |
|---|---|---|
| `id` | `uuid` | **PK**, default `gen_random_uuid()` |
| `conversation_id` | `uuid` | FK → `public.conversations(id)`, not null, cascade delete |
| `role` | `text` | not null, check in `('user','assistant')` |
| `content` | `text` | not null |
| `file_url` | `text` | nullable |
| `file_name` | `text` | nullable |
| `metadata` | `jsonb` | nullable (VAT reports, analysis, etc.) |
| `created_at` | `timestamptz` | default `now()` |

**Indexes**

- `idx_messages_conversation_id (conversation_id)`
- `idx_messages_created_at (created_at)`
- `idx_messages_metadata_type ((metadata->>'type'))` where metadata not null

**RLS (enabled)**

- CRUD allowed only if parent conversation belongs to user.

---

## 6. VAT & Accounting Intelligence

### 6.1 `public.vat_reports` (implemented)

Persisted VAT analysis results.

| Column | Type | Constraints / Default |
|---|---|---|
| `id` | `uuid` | **PK**, default `gen_random_uuid()` |
| `user_id` | `uuid` | FK → `auth.users(id)`, cascade delete |
| `conversation_id` | `uuid` | FK → `public.conversations(id)`, nullable, set null on delete |
| `period` | `text` | not null (YYYY‑MM) |
| `company_name` | `text` | nullable |
| `report_data` | `jsonb` | not null |
| `source_filename` | `text` | nullable |
| `created_at` | `timestamptz` | default `now()` |

**Indexes**

- `idx_vat_reports_conversation_id (conversation_id)`
- `idx_vat_reports_user_period (user_id, period)`

**RLS (enabled)**

- `SELECT/INSERT`: only own rows (`auth.uid() = user_id`).

### 6.2 `public.expense_patterns` (implemented)

Learned categorization patterns for auto‑suggesting BAS accounts.

| Column | Type | Constraints / Default |
|---|---|---|
| `id` | `uuid` | **PK**, default `gen_random_uuid()` |
| `user_id` | `uuid` | FK → `auth.users(id)`, not null |
| `company_id` | `text` | not null |
| `supplier_name` | `text` | not null |
| `supplier_name_normalized` | `text` | not null |
| `description_keywords` | `text[]` | default `{}` |
| `bas_account` | `text` | not null |
| `bas_account_name` | `text` | not null |
| `vat_rate` | `int` | not null, default `25` |
| `expense_type` | `text` | not null, default `'cost'`, check in `('cost','sale')` |
| `category` | `text` | nullable |
| `usage_count` | `int` | not null, default `1` |
| `total_amount` | `decimal(12,2)` | not null, default `0` |
| `avg_amount` | `decimal(12,2)` | not null, default `0` |
| `min_amount` | `decimal(12,2)` | nullable |
| `max_amount` | `decimal(12,2)` | nullable |
| `confirmation_count` | `int` | not null, default `0` |
| `rejection_count` | `int` | not null, default `0` |
| `first_used_at` | `timestamptz` | default `now()` |
| `last_used_at` | `timestamptz` | default `now()` |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()` |

**Indexes**

- `idx_expense_patterns_user_company (user_id, company_id)`
- `idx_expense_patterns_supplier_normalized (user_id, company_id, supplier_name_normalized)`
- `idx_expense_patterns_last_used (last_used_at desc)`
- `idx_expense_patterns_supplier_trgm` GIN trigram on `supplier_name_normalized`

**Functions (security definer)**

- `find_expense_patterns(...)`
- `upsert_expense_pattern(...)`
- `reject_expense_pattern(...)`

**RLS (enabled)**

- CRUD only for owner (`auth.uid() = user_id`).

---

## 7. Missing Platform Data (proposed additions)

The frontend currently stores company‑scoped bookkeeping data in localStorage (`src/types/company.ts`).  
To fully migrate persistence to Supabase, add the following tables.

### 7.1 `public.companies` (proposed)

Stores company metadata per user. Uses TEXT IDs to match existing localStorage ids (`company-<timestamp>`).  
Once added, existing `company_id TEXT` columns can be FK‑linked to `companies.id`.

```sql
create table public.companies (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  org_number text,
  address text,
  phone text,
  verification_counter integer not null default 1,
  active_conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_companies_user_id on public.companies(user_id);

alter table public.companies enable row level security;
create policy "Users can manage own companies"
  on public.companies for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop trigger if exists update_companies_updated_at on public.companies;
create trigger update_companies_updated_at
  before update on public.companies
  for each row execute function public.update_updated_at_column();
```

### 7.2 `public.bookkeeping_entries` (proposed)

Persistent ledger/history rows (`BookkeepingEntry`).

```sql
create table public.bookkeeping_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id text not null references public.companies(id) on delete cascade,

  entry_date date not null,
  description text not null,
  verification_number integer not null,
  debit decimal(12,2) not null default 0,
  credit decimal(12,2) not null default 0,
  account text not null,
  account_name text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ck_debit_nonnegative check (debit >= 0),
  constraint ck_credit_nonnegative check (credit >= 0),
  constraint uq_company_verification unique (company_id, verification_number)
);

create index idx_bookkeeping_entries_user_company on public.bookkeeping_entries(user_id, company_id);
create index idx_bookkeeping_entries_company_date on public.bookkeeping_entries(company_id, entry_date desc);

alter table public.bookkeeping_entries enable row level security;
create policy "Users can manage own bookkeeping entries"
  on public.bookkeeping_entries for all
  using (
    exists (
      select 1 from public.companies c
      where c.id = bookkeeping_entries.company_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.companies c
      where c.id = bookkeeping_entries.company_id
        and c.user_id = (select auth.uid())
    )
  );

drop trigger if exists update_bookkeeping_entries_updated_at on public.bookkeeping_entries;
create trigger update_bookkeeping_entries_updated_at
  before update on public.bookkeeping_entries
  for each row execute function public.update_updated_at_column();
```

### 7.3 `public.supplier_invoices` (proposed)

Persistent supplier invoice list (`SupplierInvoice`).

```sql
create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id text not null references public.companies(id) on delete cascade,

  invoice_number text not null,
  supplier text not null,
  amount decimal(12,2) not null,
  vat decimal(12,2) not null default 0,
  vat_rate integer not null default 25 check (vat_rate in (25, 12, 6, 0)),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending','paid','overdue')),
  paid_at timestamptz,
  description text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_supplier_invoices_user_company on public.supplier_invoices(user_id, company_id);
create index idx_supplier_invoices_company_status on public.supplier_invoices(company_id, status);
create index idx_supplier_invoices_company_due_date on public.supplier_invoices(company_id, due_date);

alter table public.supplier_invoices enable row level security;
create policy "Users can manage own supplier invoices"
  on public.supplier_invoices for all
  using (
    exists (
      select 1 from public.companies c
      where c.id = supplier_invoices.company_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.companies c
      where c.id = supplier_invoices.company_id
        and c.user_id = (select auth.uid())
    )
  );

drop trigger if exists update_supplier_invoices_updated_at on public.supplier_invoices;
create trigger update_supplier_invoices_updated_at
  before update on public.supplier_invoices
  for each row execute function public.update_updated_at_column();
```

### 7.4 `public.company_documents` (proposed)

Generic documents per company (`CompanyDocument`).  
Excel files may continue using `public.files` or be unified later.

```sql
create table public.company_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id text not null references public.companies(id) on delete cascade,

  name text not null,
  doc_type text not null check (doc_type in ('pdf','excel','image','other')),
  category text check (category in ('invoice','receipt','contract','report','other')),
  url text not null,
  storage_bucket text,
  storage_path text,
  size bigint not null,
  description text,
  uploaded_at timestamptz not null default now()
);

create index idx_company_documents_user_company on public.company_documents(user_id, company_id);
create index idx_company_documents_company_type on public.company_documents(company_id, doc_type);

alter table public.company_documents enable row level security;
create policy "Users can manage own company documents"
  on public.company_documents for all
  using (
    exists (
      select 1 from public.companies c
      where c.id = company_documents.company_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.companies c
      where c.id = company_documents.company_id
        and c.user_id = (select auth.uid())
    )
  );
```

---

## 8. Recommended follow‑ups

1. **Add migrations** for the proposed tables (`companies`, `bookkeeping_entries`, `supplier_invoices`, `company_documents`).  
2. **FK hardening:** after `companies` exists, add FKs for existing `company_id` columns where safe (`conversations`, `messages` via conversations, `files`, `expense_patterns`, `api_usage`, `vat_reports`).  
3. **Normalize `files.user_id` to UUID** in a future breaking migration (requires data backfill + code update).  
4. Add RLS for `terms_versions` if you want public read‑only.

