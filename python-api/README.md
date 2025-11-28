# Britta VAT API

Python FastAPI backend for Swedish VAT calculations using the `svensk-ekonomi` skill.

## Features

- Parse Excel files with Swedish VAT transactions
- Calculate VAT according to Swedish rules (25%, 12%, 6%, 0%)
- Generate journal entries with BAS account numbers
- Validate Swedish organization numbers
- Transform data to match TypeScript frontend format

## Local Development

### Prerequisites

- Python 3.11+
- Virtual environment tool (venv)

### Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env

# Run the API
uvicorn app.main:app --reload --port 8080
```

### Test Endpoints

```bash
# Health check
curl http://localhost:8080/health

# Root endpoint
curl http://localhost:8080/

# VAT analysis (requires base64 encoded Excel file)
curl -X POST http://localhost:8080/api/v1/vat/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "file_data": "base64_encoded_excel_data",
    "filename": "transactions.xlsx",
    "company_name": "Test AB",
    "org_number": "556183-9191",
    "period": "2025-11"
  }'
```

## Deployment

### Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up

# Set environment variables in Railway dashboard
```

## Architecture

- **FastAPI**: Modern Python web framework
- **Pandas**: Excel file processing
- **Pydantic**: Data validation matching TypeScript interfaces
- **svensk-ekonomi**: Swedish VAT calculation engine

## Project Structure

```
python-api/
├── app/
│   ├── main.py              # FastAPI application
│   ├── config.py            # Configuration settings
│   ├── api/
│   │   ├── routes/
│   │   │   ├── vat.py      # VAT endpoints
│   │   │   └── health.py   # Health check
│   │   └── models/
│   │       └── response.py # Pydantic models
│   └── services/
│       ├── vat_service.py   # VAT processing + transformation
│       └── excel_service.py # Excel parsing
├── requirements.txt
├── Procfile                 # Railway deployment
└── README.md
```

## Integration

This API is called by the Supabase `python-proxy` Edge Function, which handles:
- Authentication (Supabase JWT validation)
- Rate limiting
- Request forwarding to Python API

Frontend → Supabase Edge Function → Python API → Response
