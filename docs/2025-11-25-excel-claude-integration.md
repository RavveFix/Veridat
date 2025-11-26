# Session 2025-11-25: Excel Workspace & Claude Integration

## Översikt
Implementerade Excel workspace layout med Claude API-integration för svensk momsredovisning.

---

## Features implementerade

### 1. Excel Workspace Layout (Split View)

**Layout:**
- Vänster panel: Chat interface
- Höger panel: Excel viewer (öppnas on-demand)
- Responsiv design: Desktop = side-by-side, Mobile = overlay

**Teknologi:**
- SheetJS (xlsx.js) för Excel-parsing
- Vanilla CSS med glassmorphism
- Smooth transitions (0.3s cubic-bezier)

**Filer:**
- [`app/index.html`](file:///Users/ravonstrawder/Desktop/Britta/app/index.html) - Workspace struktur
- [`app/src/css/main.css`](file:///Users/ravonstrawder/Desktop/Britta/app/src/css/main.css) - Styling för split-view
- [`app/src/js/excelViewer.js`](file:///Users/ravonstrawder/Desktop/Britta/app/src/js/excelViewer.js) - Excel parser & renderer

**Features:**
- ✅ Multi-sheet support med tab-navigation
- ✅ Clickable file attachments i chat
- ✅ Sticky table headers
- ✅ Scrollbar custom styling

---

### 2. Supabase File Storage

**Database:**
- Ny tabell: `files` för metadata
- Storage bucket: `excel-files` (public read)
- RLS policies för access control

**Edge Function:**
- [`supabase/functions/upload-file/index.ts`](file:///Users/ravonstrawder/Desktop/Britta/supabase/functions/upload-file/index.ts)
- Hanterar base64 → Supabase Storage → metadata i DB
- Returns public URL för viewing

**Migration:**
- [`20241125000001_create_files_table.sql`](file:///Users/ravonstrawder/Desktop/Britta/supabase/migrations/20241125000001_create_files_table.sql)

---

### 3. Claude API Integration

**Provider Selection:**
```javascript
if (file.endsWith('.xlsx')) {
  → Claude (strukturerad analys)
} else {
  → Gemini (bilder, PDF, text)
}
```

**Claude Edge Function:**
- [`supabase/functions/claude-analyze/index.ts`](file:///Users/ravonstrawder/Desktop/Britta/supabase/functions/claude-analyze/index.ts)
- Modell: `claude-sonnet-4-20250514`
- Tool use schema för garanterad JSON-struktur
- System prompt: Svensk redovisningsexpert

**Output Schema:**
```typescript
{
  period: "YYYY-MM",
  summary: { total_revenue, total_costs, result },
  revenue: [...],  // Med momssatser
  costs: [...],    // Med ingående moms
  vat_summary: {
    outgoing_vat_25,
    incoming_vat,
    net_vat
  },
  journal_entries: [...],  // BAS-konton
  warnings: [...]
}
```

**Svensk Sammanfattning i Chat:**
```
**Sammanfattning för 2025-10**

**Intäkter:**
• Laddningssessioner: 65.17 SEK exkl moms (25% moms)
• Roaming: 233.65 SEK (momsfritt)
• Total försäljning: 298.81 SEK

**Momsredovisning:**
• Utgående moms 25%: 16.29 SEK
• Ingående moms 25%: 101.54 SEK
• Moms att återfå: 85.25 SEK

**Resultat:** -127.67 SEK (förlust)
```

---

### 4. Frontend Integration

**Nya funktioner i `main.js`:**

**`analyzeExcelWithClaude(file)`:**
- Konverterar Excel → base64
- Anropar Claude Edge Function
- Returns strukturerad VAT-rapport

**`renderVATSummary(report)`:**
- Formaterar Claude-output till svensk text
- Markdown-formatering för chat
- Inkluderar varningar och bokföringsförslag

**Upload Flow Update:**
```javascript
// Excel-filer
upload → Supabase Storage (för viewer)
      → Claude (för analys)
      → Visa sammanfattning i chat
      → Öppna Excel viewer

// Andra filer
upload → Gemini (som tidigare)
```

**LocalStorage:**
- Sparar senaste VAT-rapporten för potentiell export

---

## Konfiguration

### Environment Variables

```bash
# Claude API
CLAUDE_API_KEY=sk-ant-...

# Gemini (befintlig)
GEMINI_API_KEY=...

# Supabase (befintlig)
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

### Supabase Secrets

```bash
supabase secrets set CLAUDE_API_KEY=sk-ant-...
```

---

## AI-Provider Setup

| Filtyp | Provider | Modell | Kostnad/användning |
|--------|----------|--------|-------------------|
| Excel (.xlsx) | Claude | Sonnet 4 | ~$0.06/fil |
| Bilder | Gemini | 2.5 Flash | Gratis tier |
| PDF | Gemini | 2.5 Flash | Gratis tier |
| Text | Gemini | 2.5 Flash | Gratis tier |

**Rationale:**
- Claude: Native Excel-support + tool use = garanterad struktur
- Gemini: Bra på svenska + redan integrerad + billigare för vanlig chat

---

## Deployment Status

✅ **Deployed:**
- `upload-file` Edge Function
- `claude-analyze` Edge Function
- Database migration (files table)
- Frontend (Excel viewer + Claude integration)

✅ **Configured:**
- Supabase Storage bucket
- RLS policies
- CORS headers
- Claude API key (production)

---

## Testing

### Manuell Test
1. Öppna `app/index.html`
2. Ladda upp Excel-fil (.xlsx)
3. Verifiera:
   - Fil syns i chat med ikon
   - Claude-analys visas (svensk sammanfattning)
   - "Klicka för att öppna" visas
   - Excel viewer öppnas vid klick
   - Sheet tabs fungerar

### Verifierade Features
- ✅ Excel upload till Supabase
- ✅ Claude-analys med tool use
- ✅ Strukturerad svensk output
- ✅ Excel viewer med multi-sheet support
- ✅ Clickable attachments
- ✅ Responsive design

---

## Skills Integration

Implementeringen följer [`svensk-ekonomi` skill](file:///Users/ravonstrawder/Desktop/Britta/.skills/svensk-ekonomi/SKILL.md):
- ✅ Svenska momssatser (25%, 12%, 6%, 0%)
- ✅ BAS-kontoplanen
- ✅ Elbilsladdning specifikt (CPO/eMSP, OCPI roaming)
- ✅ Validering av momsberäkningar
- ✅ Periodisering (YYYY-MM format)

---

## Nästa Steg (Möjliga förbättringar)

### Kort sikt
- [ ] Export till SIE-format (bokföringsprogram)
- [ ] Spara VAT-rapporter i database
- [ ] Historik över analyserade filer

### Lång sikt
- [ ] Excel-editing i viewer
- [ ] Automatisk kategorisering med ML
- [ ] Integration med Fortnox för bokföring
- [ ] Batch-analys av flera filer

---

## Referenser

- [Implementation Plan](file:///Users/ravonstrawder/.gemini/antigravity/brain/3efe0b97-5d30-427c-8a3f-3c8d71df0bf6/claude_integration_plan.md)
- [Walkthrough](file:///Users/ravonstrawder/.gemini/antigravity/brain/3efe0b97-5d30-427c-8a3f-3c8d71df0bf6/walkthrough.md)
- [Task Checklist](file:///Users/ravonstrawder/.gemini/antigravity/brain/3efe0b97-5d30-427c-8a3f-3c8d71df0bf6/task.md)

---

**Session Duration:** ~2 timmar  
**Commits:** Excel workspace + Claude integration  
**Status:** ✅ Production ready
