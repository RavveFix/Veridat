# Fortnox Voucher Attachment — Design Spec

**Date:** 2026-03-13
**Status:** Approved

## Problem

När användaren godkänner en kontering (via ActionPlanCard → export_journal_to_fortnox) som startade med en uppladdad fil (kvitto/faktura), bifogas INTE filen till verifikationen i Fortnox. Svensk bokföringslag kräver att underlag (verifikat) bifogas verifikationen.

## Decision Log

| Fråga | Beslut | Motivering |
|-------|--------|------------|
| Fortnox Inbox vs direkt till verifikation? | Direkt till verifikation (fileattachments API) | Fullt automatiserat, juridiskt korrekt |
| Hur hantera expired signed URLs? | Spara storage path i action plan, hämta vid execution | Lättviktigt, edge functions har service role access |
| Vilka filformat? | Bara PDF + bilder | Verifikat = kvitton/fakturor, inte Excel-analysfiler |
| Arkitekturansats? | Utöka befintlig fortnox edge function | Följer etablerat mönster, ingen ny infrastruktur |

## Architecture: Approach 3 — Utöka befintlig fortnox edge function

Ny `attachFileToVoucher` action i `fortnox/index.ts`, anropas av `gemini-chat` efter lyckat voucher-skapande.

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

3. Användaren godkänner → exportVoucher → Verifikation A123 skapad

4. source_file finns? →
   a. Hämta fil från Supabase Storage (service role)
   b. Anropa fortnox: attachFileToVoucher(A, 123, fileData, "kvitto.pdf")
   c. Streama bekräftelse: "Verifikation A123 skapad med bifogat kvitto ✓"

5. Fil-upload misslyckas? → Icke-blockerande.
   "Verifikation A123 skapad. Kvittot kunde inte bifogas — ladda upp manuellt i Fortnox."
```

## Komponenter att ändra

### 1. `supabase/services/FortnoxService.ts` — Ny metod

```typescript
async uploadFileAttachment(
  voucherSeries: string,
  voucherNumber: number,
  fileData: Uint8Array,
  fileName: string,
  mimeType: string
): Promise<{ Id: string; FileName: string }>
```

- Endpoint: `POST /3/vouchers/{VoucherSeries}/{VoucherNumber}/fileattachments`
- Content-Type: `multipart/form-data`
- Eget fetch-anrop (inte befintlig `request()`) med samma auth-header
- Rate limiting gäller

### 2. `supabase/functions/fortnox/index.ts` — Ny action

```typescript
case "attachFileToVoucher": {
  const { voucherSeries, voucherNumber, fileData, fileName, mimeType } = payload;
  // Decode base64 → Uint8Array
  // Call FortnoxService.uploadFileAttachment()
  return { success: true, attachmentId: result.Id };
}
```

### 3. `supabase/functions/fortnox/types.ts` — Ny typ

```typescript
interface FortnoxFileAttachmentResponse {
  FileAttachment: {
    Id: string;
    FileName: string;
    ContentType: string;
  }
}
```

### 4. `supabase/functions/gemini-chat/index.ts` — Propagera filreferens

**Vid propose_action_plan (ca rad 4056-4113):**
- Sök konversationshistorik bakåt efter senaste user-meddelande med PDF/bild
- Extrahera storage path från file_url
- Lägg till `source_file` i action plan metadata

**Vid action plan execution (ca rad 2419-2431):**
- Efter lyckat exportVoucher, kolla om source_file finns
- Hämta fil: `supabaseAdmin.storage.from('chat-files').download(storage_path)`
- Konvertera till base64
- Anropa fortnox edge function: `attachFileToVoucher`
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

## Felhantering

| Scenario | Hantering |
|----------|-----------|
| Fil-upload till Fortnox misslyckas | Icke-blockerande. Verifikation skapad, användaren informeras |
| Storage path saknas/ogiltig | Skippa attachment, logga varning |
| Fil ej hittad i Storage | Skippa attachment, informera användaren |
| Fortnox 401 (auth) | Standard token refresh + retry (befintlig logik) |
| Fortnox 429 (rate limit) | Standard retry med backoff (befintlig logik) |
| Ingen source_file i action plan | Inget händer — befintligt beteende |

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
