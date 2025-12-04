# AI-First Excel Analysis

## Overview

Inspired by Claude Artifacts, this system uses AI to intelligently parse ANY Excel format for Swedish VAT reporting.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                  │
├─────────────────────────────────────────────────────────────────┤
│  ExcelWorkspace.tsx                                             │
│  ├── StreamingProgress (shows AI "thinking")                    │
│  ├── ColumnMappingPreview (what AI found)                       │
│  ├── VATReportArtifact (interactive report)                     │
│  └── FollowUpSuggestions (conversational prompts)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EDGE FUNCTIONS                                │
├─────────────────────────────────────────────────────────────────┤
│  analyze-excel-ai/                                              │
│  ├── Step 1: Parse Excel → Extract columns + sample rows        │
│  ├── Step 2: Gemini AI → Intelligent column mapping             │
│  ├── Step 3: Normalize data → Standard format                   │
│  └── Step 4: Call Python API → Exact VAT calculations           │
│                                                                 │
│  gemini-chat/ (existing)                                        │
│  └── Handle follow-up questions about the report                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PYTHON API (Railway)                          │
├─────────────────────────────────────────────────────────────────┤
│  /api/v1/vat/calculate                                          │
│  ├── Input: Normalized transaction array                        │
│  ├── Process: Swedish VAT rules (25%, 12%, 6%, 0%)             │
│  └── Output: VATReportResponse                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. User Uploads Excel

```typescript
// Frontend sends file to analyze-excel-ai
const response = await supabase.functions.invoke('analyze-excel-ai', {
  body: { file_data: base64, filename: 'transactions.xlsx' }
});
```

### 2. Edge Function Parses Excel

```typescript
// Uses xlsx library to extract structure
const workbook = XLSX.read(fileBuffer);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

const columns = data[0]; // Header row
const sampleRows = data.slice(1, 4); // First 3 data rows
const totalRows = data.length - 1;
```

### 3. AI Analyzes Structure

```typescript
const prompt = `
Du är en expert på svensk bokföring och Excel-analys.

Analysera denna Excel-fil och identifiera kolumnerna för momsredovisning:

**Kolumner i filen:**
${columns.join(', ')}

**Exempel på data (första 3 raderna):**
${sampleRows.map(row => row.join(' | ')).join('\n')}

**Din uppgift:**
1. Identifiera vilken typ av data detta är (t.ex. försäljning, laddtransaktioner, fakturor)
2. Mappa kolumner till dessa standardfält:
   - amount: Totalbelopp inklusive moms
   - net_amount: Belopp exklusive moms
   - vat_amount: Momsbeloppet
   - vat_rate: Momssats (25, 12, 6, eller 0)
   - description: Beskrivning av transaktionen
   - date: Transaktionsdatum
   - type: "sale" eller "cost"

3. Om momssats saknas men du ser belopp inkl/exkl moms, beräkna satsen.

Svara ENDAST med JSON i detta format:
{
  "file_type": "EV Charging Transactions",
  "confidence": 0.95,
  "row_count": 361,
  "date_range": { "from": "2024-01-01", "to": "2024-12-31" },
  "column_mapping": {
    "amount": "priceInclVat",
    "net_amount": "priceExclVat",
    "vat_amount": "vatAmount",
    "vat_rate": "vatPercent",
    "description": "chargePointName",
    "date": "startTime",
    "type": "sale"
  },
  "unmapped_columns": ["userId", "sessionId", ...],
  "notes": "Alla transaktioner är försäljning av laddtjänster med 25% moms"
}
`;
```

### 4. Normalize Data

```typescript
// Transform using AI's mapping
const normalizedTransactions = rawData.map(row => ({
  amount: parseFloat(row[mapping.amount]) || 0,
  net_amount: parseFloat(row[mapping.net_amount]) || 0,
  vat_amount: parseFloat(row[mapping.vat_amount]) || 0,
  vat_rate: parseFloat(row[mapping.vat_rate]) || 25,
  description: String(row[mapping.description] || ''),
  date: row[mapping.date],
  type: mapping.type
}));
```

### 5. Send to Python for Calculations

```typescript
// Python API now receives clean, normalized data
const vatReport = await pythonAPI.calculate({
  transactions: normalizedTransactions,
  company_name: 'Company AB',
  org_number: '556123-4567',
  period: '2024'
});
```

## New API Contracts

### analyze-excel-ai Request

```typescript
interface AnalyzeExcelRequest {
  file_data: string;      // base64 encoded
  filename: string;
  company_name?: string;
  org_number?: string;
  period?: string;        // If not provided, detect from data
}
```

### analyze-excel-ai Response (Streaming)

```typescript
// Step 1: Initial analysis
{
  step: 'parsing',
  message: 'Läser Excel-fil...',
  progress: 0.2
}

// Step 2: AI analysis
{
  step: 'analyzing',
  message: 'Identifierar kolumner...',
  progress: 0.4,
  details: {
    file_type: 'EV Charging Transactions',
    columns_found: 74,
    rows_found: 361
  }
}

// Step 3: Column mapping
{
  step: 'mapping',
  message: 'Jag ser att detta är en EV-laddningsexport...',
  progress: 0.6,
  mapping: {
    amount: { column: 'priceInclVat', confidence: 0.98 },
    net_amount: { column: 'priceExclVat', confidence: 0.98 },
    // ...
  }
}

// Step 4: Calculating
{
  step: 'calculating',
  message: 'Beräknar momsunderlag...',
  progress: 0.8
}

// Step 5: Complete
{
  step: 'complete',
  message: 'Analys klar!',
  progress: 1.0,
  report: { /* VATReportResponse */ }
}
```

## Python API Changes

### New Endpoint: /api/v1/vat/calculate

```python
@router.post("/calculate")
async def calculate_vat(request: CalculateVATRequest):
    """
    Calculate VAT from pre-normalized transaction data.
    This endpoint receives clean data from the AI analyzer.
    """
    # Input is already normalized - no column mapping needed
    transactions = request.transactions

    # Group by type (sales vs costs)
    sales = [t for t in transactions if t.type == 'sale']
    costs = [t for t in transactions if t.type == 'cost']

    # Calculate VAT per rate
    vat_summary = calculate_vat_by_rate(sales, costs)

    # Generate report
    return VATReportResponse(...)
```

### New Request Model

```python
class NormalizedTransaction(BaseModel):
    amount: float           # Total incl VAT
    net_amount: float       # Total excl VAT
    vat_amount: float       # VAT amount
    vat_rate: float         # 25, 12, 6, or 0
    description: str
    date: Optional[str]
    type: Literal["sale", "cost"]

class CalculateVATRequest(BaseModel):
    transactions: List[NormalizedTransaction]
    company_name: str
    org_number: str
    period: str
```

## UI Components

### StreamingProgress

```tsx
const StreamingProgress = ({ step, message, progress, details }) => {
  return (
    <div className="streaming-progress">
      <div className="progress-bar" style={{ width: `${progress * 100}%` }} />

      <div className="step-indicator">
        {step === 'parsing' && <SpinnerIcon />}
        {step === 'analyzing' && <BrainIcon />}
        {step === 'mapping' && <LinkIcon />}
        {step === 'calculating' && <CalculatorIcon />}
        {step === 'complete' && <CheckIcon />}
      </div>

      <p className="message">{message}</p>

      {details && (
        <div className="details">
          <span>{details.file_type}</span>
          <span>{details.rows_found} rader</span>
        </div>
      )}
    </div>
  );
};
```

### FollowUpSuggestions

```tsx
const suggestions = [
  "Visa fördelning per månad",
  "Vilka transaktioner har högst belopp?",
  "Exportera till SIE-fil",
  "Skicka till Fortnox"
];

const FollowUpSuggestions = ({ onSelect }) => (
  <div className="follow-up-suggestions">
    {suggestions.map(suggestion => (
      <button
        key={suggestion}
        onClick={() => onSelect(suggestion)}
        className="suggestion-chip"
      >
        💬 {suggestion}
      </button>
    ))}
  </div>
);
```

## Benefits

1. **100% Format Support**: AI understands any Excel structure
2. **Self-Documenting**: AI explains what it found
3. **Graceful Degradation**: If unsure, asks user for help
4. **Conversational**: Follow-up questions refine results
5. **Premium Value**: "Magic" AI experience worth paying for

## Implementation Order

1. [ ] Create `analyze-excel-ai` Edge Function
2. [ ] Add `/api/v1/vat/calculate` endpoint to Python API
3. [ ] Update `ExcelWorkspace` with streaming UI
4. [ ] Add `FollowUpSuggestions` component
5. [ ] Connect to existing `gemini-chat` for follow-ups
6. [ ] Add format caching for learned mappings (Premium)

---

*Created: 2024-12-04*
*Status: Planning*
