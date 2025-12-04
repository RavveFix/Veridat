# Testing Guide

## Test Commands

```bash
# Python unit tests
cd python-api && pytest tests/ -v

# Specific test file
pytest tests/test_security.py -v

# API verification (requires running server)
python3 verify_api.py

# Production API verification
PYTHON_API_URL=https://your-api.railway.app python3 verify_api.py

# Rate limiting test
deno run --allow-all test_rate_limit.ts
```

---

## Unit Tests

### Python API (`python-api/tests/`)

**test_security.py** - Security module tests:
- Fail-open behavior (no API key configured)
- API key validation (correct/incorrect)
- Timing attack resistance
- Edge cases (empty key, whitespace)

**Running Tests:**
```bash
cd python-api
source venv/bin/activate
pytest tests/ -v
```

**Expected Output:**
```
tests/test_security.py::test_fail_open_when_no_key_configured PASSED
tests/test_security.py::test_valid_api_key PASSED
tests/test_security.py::test_invalid_api_key PASSED
tests/test_security.py::test_timing_attack_resistance PASSED
...
7 passed in 0.15s
```

---

## API Verification

### verify_api.py
Tests Python API endpoints with sample data:

```bash
cd python-api
python3 verify_api.py
```

**Checks:**
1. Health endpoint returns 200
2. VAT calculation endpoint works
3. Response format is correct
4. Calculations are accurate

**Configuration:**
```python
# Default: http://localhost:8080
# Override with environment variable:
PYTHON_API_URL=https://your-api.railway.app python3 verify_api.py
```

---

## Integration Testing

### VAT Calculation Flow
1. Upload `test_transactions.xlsx`
2. Verify routing to Python API
3. Check response format
4. Validate calculations

**Expected Console Output:**
```
[Python API] Base64 data length: 14392
[Python API] Sending to python-proxy...
[Python API] Success
[Router] Python API succeeded
```

### Gemini Chat Flow
1. Send text message
2. Verify response in Swedish
3. Check rate limiting headers

### Fortnox Integration
1. Authenticate via OAuth
2. Fetch customers
3. Create test invoice
4. Verify in Fortnox dashboard

---

## Rate Limiting Tests

```bash
deno run --allow-all test_rate_limit.ts
```

**Test Scenarios:**
1. 10 requests within 1 minute → All succeed
2. 11th request → 429 Too Many Requests
3. Wait for reset → Requests succeed again

---

## Test Data

### test_transactions.xlsx
Located in project root, contains sample Swedish transactions:
- Various VAT rates (25%, 12%, 6%, 0%)
- EV charging transactions
- Valid org numbers

### Expected Results
```
Försäljning: 298.81 SEK
Kostnader: 426.48 SEK
```

---

## Debugging Tests

### Frontend Console
```javascript
// Enable verbose logging
localStorage.setItem('DEBUG', 'true');
```

### Edge Function Logs
```bash
supabase functions logs gemini-chat --tail
```

### Python API Logs
Check Railway dashboard or local terminal output.

---

## CI/CD Integration

### GitHub Actions (future)
```yaml
- name: Run Python tests
  run: |
    cd python-api
    pip install -r requirements.txt
    pytest tests/ -v

- name: Verify API
  run: |
    cd python-api
    python3 verify_api.py
```

---

## Test Checklist

### Before Commit
- [ ] Unit tests pass (`pytest tests/ -v`)
- [ ] API verification passes (`python3 verify_api.py`)
- [ ] No console errors in frontend

### Before Deploy
- [ ] All unit tests pass
- [ ] Integration tests pass
- [ ] Rate limiting works
- [ ] Production API responds

### After Deploy
- [ ] Health endpoint responds
- [ ] VAT calculation works
- [ ] No fallback to Claude (check logs)
- [ ] Consistent results on repeated uploads
