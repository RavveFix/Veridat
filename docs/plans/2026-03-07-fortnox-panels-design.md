# Fortnox Panels Design — Fas 3

**Date:** 2026-03-07
**Branch:** `feat/fortnox-panels`

## Context

Fas 1 (auth + dashboard + layout) is done. Fas 2 (chat) is being built separately. This work prepares the Fortnox integration as independent components that don't conflict with chat development.

The backend is 100% ready — Edge Functions for OAuth and all Fortnox API operations exist. The `fortnox_tokens` table is scoped per `(user_id, company_id)`. This task builds the frontend panels.

## Architecture: RSC Shell + Client Island Mutations

- **Server Components** for initial data loading (connection status from DB)
- **Client Components** for interactive parts (OAuth connect/disconnect, VAT period picker)
- **No new data fetching library** — thin `fortnox-api.ts` utility with direct fetch to Edge Functions
- **Native `<dialog>`** for modal (zero deps, built-in a11y)

### Data Flow

```
Dashboard Page (RSC)
  |-- fetches fortnox_tokens from DB
  |-- passes fortnoxConnected + companyId as props
  |
  FortnoxPanel (RSC shell)
  |   |-- Not connected: <ConnectionCard /> (client)
  |   |-- Connected: <VATReportCard /> (client, fetches via api.ts)
  |
AppSidebar (client)
    |-- Integrationer button -> <IntegrationsModal />
        |-- <Modal> (native <dialog>)
            |-- <ConnectionCard /> (reused)
```

## File Structure

```
src/
  types/fortnox.ts                         # Frontend Fortnox types
  lib/fortnox/api.ts                       # Edge Function fetch wrapper
  hooks/use-fortnox.ts                     # OAuth mutation hook only
  components/
    modals/modal.tsx                        # Reusable <dialog> base
    modals/integrations-modal.tsx           # Integration list
    fortnox/connection-card.tsx             # Connect/disconnect UI
    fortnox/vat-report-card.tsx             # VAT report + period picker
    fortnox/fortnox-panel.tsx               # Dashboard widget (RSC)

Modified:
  components/sidebar/app-sidebar.tsx        # Wire Integrationer button
  app/(dashboard)/page.tsx                  # Replace StatsCard with FortnoxPanel
```

## Component Details

### 1. types/fortnox.ts
Adapted from `supabase/functions/fortnox/types.ts`:
- FortnoxConnectionStatus, FortnoxInvoice, FortnoxInvoiceRow
- FortnoxVoucher, FortnoxVoucherRow, FortnoxAccount
- VATReportData (period, rows per momssats, totals)
- FortnoxApiError

### 2. lib/fortnox/api.ts
Thin fetch wrapper matching chat-service.ts pattern:
- `fortnoxCall<T>(action, params)` — POST to /functions/v1/fortnox with Bearer token
- `fortnoxOAuth(action, params)` — POST to /functions/v1/fortnox-oauth
- Specific wrappers: getVATReport, getInvoices, initiateOAuth, disconnectFortnox

### 3. hooks/use-fortnox.ts
Minimal — only for OAuth mutations:
- `useFortnoxOAuth(companyId)` -> { connect, disconnect, isConnecting, error }
- connect() gets auth URL then `window.location.href = url`
- disconnect() calls API then `router.refresh()`

### 4. modals/modal.tsx
Reusable `<dialog>` wrapper:
- Props: open, onClose, title, children
- useRef + useEffect for showModal()/close()
- Click-outside-to-close via ::backdrop
- Styled with --card-bg, --border-color tokens

### 5. modals/integrations-modal.tsx
- Lists integrations (Fortnox first, Bank/other as "coming soon")
- Fortnox row embeds <ConnectionCard />
- Triggered from sidebar + dashboard widget

### 6. fortnox/connection-card.tsx (client)
- Not connected: "Anslut Fortnox" button (accent gradient)
- Connected: company info + "Koppla fran" button (danger)
- Connecting: spinner
- Uses useFortnoxOAuth hook

### 7. fortnox/vat-report-card.tsx (client)
- Period picker: year + period selects
- Table: momssats | underlag | moms
- Totals formatted as SEK
- Loading skeleton, error state with retry

### 8. fortnox/fortnox-panel.tsx (RSC)
- Receives fortnoxConnected + companyId as props
- Not connected: renders ConnectionCard
- Connected: renders compact stats + VATReportCard
- "Hantera integrationer" link (triggers modal)

## Key Decisions

- **Native `<dialog>`** over custom overlay — zero deps, top-layer, focus trap built in
- **No React Query** — plain useState for loading/error in the 2-3 client components that fetch
- **Types copied, not shared** — avoids cross-project import complexity
- **OAuth redirect** handled by existing fortnox-oauth Edge Function callback
- **Company ID** passed from RSC (first company from DB query, same as current page.tsx)
