# Fortnox Voucher Attachment — Design Spec

**Date:** 2026-03-13
**Status:** Approved (rev 2 — post spec review)

## Problem

När användaren godkänner en kontering (via ActionPlanCard → export_journal_to_fortnox) som startade med en uppladdad fil (kvitto/faktura), bifogas INTE filen till verifikationen i Fortnox. Svensk bokföringslag kräver att underlag (verifikat) bifogas verifikationen.

## Decision Log

| Fråga | Beslut | Motivering |
|-------|--------|------------|
| Fortnox Inbox vs direkt till verifikation? | Tvåstegsprocess: Inbox upload → VoucherFileConnection | Fortnox API kräver detta — ingen direktuppladdning till verifikation |
| Hur hantera expired signed URLs? | Spara storage path i action plan, hämta vid execution | Lättviktigt, edge functions har service role access |
| Vilka filformat? | Bara PDF + bilder (max 5 MB) | Verifikat = kvitton/fakturor, inte Excel. Fortnox max 5 MB |
| Arkitekturansats? | Utöka befintlig fortnox edge function | Följer etablerat mönster, ingen ny infrastruktur |
| Vem hämtar filen från Storage? | Fortnox edge function (inte gemini-chat) | Undviker att shuttla stora base64-payloads mellan edge functions |

## Architecture: Approach 3 — Utöka befintlig fortnox edge function

Ny `attachFileToVoucher` action i `fortnox/index.ts`, anropas av `gemini-chat` efter lyckat voucher-skapande. Fortnox edge function hämtar filen direkt från Supabase Storage.

## Fortnox API — Tvåstegsprocess

Fortnox API stödjer INTE direkt filuppladdning till verifikationer. Flödet är:

**Steg 1 — Ladda upp fil till Inbox:**
```
POST /3/inbox
Content-Type: multipart/form-data
Body: file (binary data stream)

Response:
{
  "File": {
    "Id": "ff696daa-bee6-4e23-b8ed-258104243e94",
    "Name": "kvitto.pdf",
    "Size": 245000
  }
}
```

**Steg 2 — Koppla fil till verifikation:**
```
POST /3/voucherfileconnections?financialyeardate=2026-01-01
Content-Type: application/json
Body:
{
  "VoucherFileConnection": {
    "FileId": "ff696daa-bee6-4e23-b8ed-258104243e94",
    "VoucherNumber": 123,
    "VoucherSeries": "A"
  }
}

Response:
{
  "VoucherFileConnection": {
    "FileId": "ff696daa-bee6-4e23-b8ed-258104243e94",
    "VoucherNumber": "123",
    "VoucherSeries": "A",
    "VoucherDescription": "Kontorsmaterial"
  }
}
```

## Dataflöde

```
1. Användaren laddar upp kvitto.pdf → Supabase Storage (chat-files bucket)
   messages.file_url = signed URL, messages.file_name = "kvitto.pdf"

2. AI analyserar filen → propose_action_plan
   Action plan berikas med source_file:
   {
     storage_path: "userId/companyId/1735689600000_kvitto.pdf",
     file_name: "kvitto.pdf",
     mime_type: "application/pdf"
   }
   storage_path extraheras från file_url via URL-parsing.

3. Användaren godkänner → exportVoucher → Verifikation A123 skapad

4. source_file finns? →
   a. Anropa fortnox edge function: attachFileToVoucher
      (skickar storage_path, fileName, mimeType — INTE fildata)
   b. Fortnox edge function hämtar filen från Supabase Storage (service role)
   c. Validerar filstorlek ≤ 5 MB
   d. POST /3/inbox (multipart/form-data) → FileId
   e. POST /3/voucherfileconnections → koppling till verifikation
   f. Streama bekräftelse: "Verifikation A123 skapad med bifogat kvitto ✓"

5. Fil-upload misslyckas? → Icke-blockerande.
   "Verifikation A123 skapad. Kvittot kunde inte bifogas — ladda upp manuellt i Fortnox."
```

## Komponenter att ändra

### 1. `supabase/services/FortnoxService.ts` — Två nya metoder

```typescript
// Steg 1: Ladda upp fil till Fortnox Inbox
async uploadToInbox(
  fileData: Uint8Array,
  fileName: string
): Promise<{ Id: string; Name: string }>
// Endpoint: POST /3/inbox
// Content-Type: multipart/form-data
// Eget fetch-anrop med auth-header (inte befintlig request())
// Replicerar: auth token retrieval, 401-retry, rate limiting, timeout, error classification

// Steg 2: Koppla fil till verifikation
async createVoucherFileConnection(
  fileId: string,
  voucherNumber: number,
  voucherSeries: string,
  financialYearDate: string
): Promise<FortnoxVoucherFileConnectionResponse>
// Endpoint: POST /3/voucherfileconnections?financialyeardate={date}
// Content-Type: application/json (kan använda befintlig request())
```

**Refaktor av `authenticatedFetch`:** Extrahera auth-header-logik till en separat `getAuthHeaders()` metod som kan återanvändas av både `request()` (JSON) och `uploadToInbox()` (multipart). Undviker kodduplicering av token retrieval, 401-retry, rate limiting.

### 2. `supabase/functions/fortnox/index.ts` — Ny action

```typescript
case "attachFileToVoucher": {
  const { storagePath, fileName, mimeType, voucherSeries, voucherNumber,
          financialYearDate } = payload;

  // 1. Hämta fil från Supabase Storage
  const { data: fileBlob } = await supabaseAdmin.storage
    .from('chat-files').download(storagePath);
  const fileData = new Uint8Array(await fileBlob.arrayBuffer());

  // 2. Validera filstorlek (max 5 MB)
  if (fileData.byteLength > 5 * 1024 * 1024) {
    return { success: false, error: "Filen överstiger 5 MB" };
  }

  // 3. Ladda upp till Fortnox Inbox
  const inboxResult = await fortnoxService.uploadToInbox(fileData, fileName);

  // 4. Koppla till verifikation
  const connection = await fortnoxService.createVoucherFileConnection(
    inboxResult.Id, voucherNumber, voucherSeries, financialYearDate
  );

  return { success: true, fileId: inboxResult.Id, connectionId: connection.FileId };
}
```

**Registrering:** Lägg till `attachFileToVoucher` i:
- `WRITE_ACTIONS_TO_OPERATION` — för audit logging
- `FAIL_CLOSED_RATE_LIMIT_ACTIONS` — för rate limiting
- `ACTIONS_REQUIRING_COMPANY_ID` — för company-ID validering

### 3. `supabase/functions/fortnox/types.ts` — Nya typer

```typescript
interface FortnoxInboxFileResponse {
  File: {
    Id: string;
    Name: string;
    Size: number;
  }
}

interface FortnoxVoucherFileConnectionResponse {
  VoucherFileConnection: {
    FileId: string;
    VoucherNumber: string;
    VoucherSeries: string;
    VoucherDescription: string;
    VoucherYear: number;
  }
}
```

### 4. `supabase/functions/gemini-chat/index.ts` — Propagera filreferens

**Vid `propose_action_plan` tool call processing (funktion som bygger action plan metadata):**
- Sök konversationshistorik bakåt efter senaste user-meddelande med PDF/bild
- Extrahera storage path från `file_url` via URL-parsing
- Lägg till `source_file` i action plan metadata

**Vid action plan execution (efter lyckat `callFortnoxWrite("exportVoucher", ...)`):**
- Kolla om `source_file` finns i action plan
- Anropa fortnox edge function med `attachFileToVoucher`:
  ```json
  {
    "action": "attachFileToVoucher",
    "storagePath": "userId/companyId/1735689600000_kvitto.pdf",
    "fileName": "kvitto.pdf",
    "mimeType": "application/pdf",
    "voucherSeries": "A",
    "voucherNumber": 123,
    "financialYearDate": "2026-01-01"
  }
  ```
- Streama bekräftelse (med eller utan bilaga)

### 5. Hjälpfunktioner i gemini-chat

```typescript
const ATTACHABLE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];

function isAttachableFile(fileName: string): boolean {
  return ATTACHABLE_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext));
}

function inferMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp'
  };
  return map[ext || ''] || 'application/octet-stream';
}

function extractStoragePath(fileUrl: string): string {
  // Parse: https://xxx.supabase.co/storage/v1/object/sign/chat-files/{path}?token=...
  // Return: {path} (without bucket name)
  const url = new URL(fileUrl);
  const match = url.pathname.match(/\/storage\/v1\/object\/sign\/chat-files\/(.+)/);
  return match ? decodeURIComponent(match[1]) : '';
}
```

**Angående URL-parsing av storage path:** `extractStoragePath` parsear signed URLs för att extrahera storage path. Detta fungerar eftersom Supabase Storage URL-format är stabilt (`/storage/v1/object/sign/{bucket}/{path}`). Om URL-formatet ändras i en framtida Supabase-version, bryts denna funktion — men storage path ligger inte sparad separat idag och att lägga till en ny kolumn eller metadata-fält vore en större ändring. URL-parsing är acceptabel som v1-approach med fallback: om parsningen misslyckas, skippa attachment och logga varning.

## Felhantering

| Scenario | Hantering |
|----------|-----------|
| Fil-upload till Fortnox misslyckas | Icke-blockerande. Verifikation skapad, användaren informeras |
| Storage path parsning misslyckas | Skippa attachment, logga varning |
| Fil ej hittad i Storage | Skippa attachment, informera användaren |
| Fil > 5 MB | Skippa attachment, informera: "Filen överstiger Fortnox maxgräns 5 MB" |
| Fortnox Inbox upload OK men connection misslyckas | Logga FileId för manuell koppling, informera användaren |
| Fortnox 401 (auth) | Standard token refresh + retry (befintlig logik) |
| Fortnox 429 (rate limit) | Standard retry med backoff (befintlig logik) |
| Ingen source_file i action plan | Inget händer — befintligt beteende |

## Idempotency

Duplicate-skydd: Om samma voucher redan har en filkoppling (retry-scenario), logga och skippa. Fortnox kan returnera error vid duplikat — detta fångas i felhanteringen och behandlas som icke-blockerande.

## Vad som INTE ändras

- Frontend (ActionPlanCard) — ingen ändring behövs
- Filuppladdningsflödet — fungerar som idag
- messages-tabellen — inga schemaändringar
- Befintlig exportVoucher-logik — oförändrad
- Excel-filhantering — berörs inte (filtreras bort)

## Juridisk grund

- BFL 5 kap 6-7§: Verifikation ska innehålla underlag
- BFNAR 2013:2 kap 2: Digitala verifikat ska arkiveras
- Filen bifogas direkt till verifikationen i Fortnox (system of record)

## Spec Review Fixes (rev 2)

| Issue | Fix |
|-------|-----|
| CRITICAL: Fortnox API endpoint fel | Korrigerat till tvåstegsprocess: POST /3/inbox → POST /3/voucherfileconnections |
| CRITICAL: Storage path inte sparad | Accepterat URL-parsing som v1 med fallback-strategi |
| IMPORTANT: authenticatedFetch hardcodar JSON | Refaktor: extrahera getAuthHeaders() för återanvändning |
| IMPORTANT: Fil-storlek saknas | Lagt till 5 MB limit (Fortnox max) |
| IMPORTANT: Base64 shuttlas mellan edge functions | Ändrat: fortnox edge function hämtar fil direkt från Storage |
| IMPORTANT: attachFileToVoucher saknas i registreringslistor | Lagt till i WRITE_ACTIONS_TO_OPERATION, FAIL_CLOSED_RATE_LIMIT_ACTIONS, ACTIONS_REQUIRING_COMPANY_ID |
| SUGGESTION: Idempotency | Lagt till duplicate-skydd sektion |
| SUGGESTION: Radnummer | Bytt till funktionsbeskrivningar istället för radnummer |

## Sources

- [Voucher File Connections | Fortnox Developer](https://developer.fortnox.se/documentation/resources/voucher-file-connections/)
- [Archive | Fortnox Developer](https://developer.fortnox.se/documentation/resources/archive/)
- [Vouchers Best Practice | Fortnox Developer](https://www.fortnox.se/developer/guides-and-good-to-know/best-practices/vouchers)
