# Debugging Guide

## Critical Debugging Session (2025-12-03)

### Problem: Inconsistent VAT Calculations

**Symptom:** Same Excel file returned different results on every upload:
- Upload 1: Försäljning 298.81 SEK, Kostnader 426.56 SEK
- Upload 2: Försäljning 299.01 SEK, Kostnader 461.27 SEK
- Upload 3: Försäljning 314.81 SEK, Kostnader 526.55 SEK

**Root Causes Discovered:**

1. **Authentication Failure (401 Unauthorized)**
   - Railway Python API had `PYTHON_API_KEY` set
   - Supabase Edge Function did NOT have matching key
   - All requests rejected → triggered Claude AI fallback
   - **Fix:** `supabase secrets set PYTHON_API_KEY=...`

2. **Pydantic Validation Error (500 Internal Server Error)**
   - `ValidationResult` expected `errors: List[str]`
   - Railway returned `errors: List[dict]`
   - **Fix:** Changed to `errors: List[Union[str, dict]]`

---

## Debugging Workflow

### 1. Check Frontend Console
```javascript
// Look for these logs:
'[Python API] Base64 data length BEFORE padding:'
'[Python API] First 50 chars:'
'[Python API] Sending to python-proxy...'
'[Python API] Success'  // or '[Python API] Error'
```

### 2. Check Edge Function Logs
```bash
supabase functions logs python-proxy --tail
```

Look for:
```
[python-proxy] Received file_data length: 14392
[python-proxy] Forwarding to Python API...
```

### 3. Check Railway Logs
In Railway dashboard, look for:
```
✅ Environment validated: ENV=production, DEBUG=False
POST /api/v1/vat/analyze - 200 OK
```

---

## Common Issues

### 401 Unauthorized
**Cause:** API key mismatch between Railway and Supabase

**Fix:**
```bash
# Set matching API key in Supabase
supabase secrets set PYTHON_API_KEY=your_railway_key
supabase functions deploy python-proxy
```

### 500 Internal Server Error
**Possible Causes:**
1. Railway cold start (wait 2-3 minutes)
2. Pydantic validation error
3. Missing environment variables

**Debug Steps:**
```bash
# Check Railway logs for specific error
# Test locally first
cd python-api
uvicorn app.main:app --reload
curl http://localhost:8080/health
```

### Inconsistent Results
**Cause:** Falling back to Claude AI instead of Python API

**Indicators:**
- Different results each upload
- Missing `[Python API] Success` in console
- Seeing `[Claude Fallback] Analyzing...`

**Fix:** Ensure Python API is accessible:
1. Check API key sync
2. Verify Railway is running
3. Check CORS configuration

---

## Retry Logic

### Railway Cold Starts
```typescript
// PythonAPIService.ts
// 3 attempts with exponential backoff: 1s, 2s, 4s
[PythonAPIService] Attempt 1/3
❌ Attempt 1/3 failed: fetch failed
⏳ Waiting 1000ms before retry...
[PythonAPIService] Attempt 2/3
✅ Success on attempt 2
```

### Email Delivery
```javascript
// LegalConsentModal.tsx
// 3 attempts with backoff: 1s, 2s
[Consent Email] Attempt 1/3...
❌ Email attempt 1/3 failed: ...
[Consent Email] Attempt 2/3...
✅ Consent confirmation email sent successfully
```

---

## Base64 Debugging

### Frontend Validation
```typescript
// src/main.ts
console.log('[Python API] Base64 data length BEFORE padding:', base64Data.length);
console.log('[Python API] First 50 chars:', base64Data.substring(0, 50));
console.log('[Python API] Last 50 chars:', base64Data.substring(base64Data.length - 50));

// Auto-padding (must be multiple of 4)
while (base64Data.length % 4 !== 0) {
    base64Data += '=';
}
```

### Edge Function Logging
```typescript
// python-proxy/index.ts
console.log("[python-proxy] Received file_data length:", body.file_data?.length || 0);
console.log("[python-proxy] Received file_data first 50 chars:", body.file_data?.substring(0, 50));
```

### Python API Validation
```python
# excel_service.py
if not file_data:
    raise FileProcessingError("Empty base64 data received")

if len(file_data) < 10:
    raise FileProcessingError(f"Base64 data too short: {len(file_data)} characters")
```

---

## Error Tracking

### Error Response Format
```typescript
{
  error: "python_api_error",
  message: "Python API error (400): Invalid base64",
  source: "python_api",        // or "edge_function"
  details: { status_code: 400 }
}
```

### Critical Failure Alert
```javascript
🚨 CRITICAL: Failed to send consent email after all retries
{
  userId: "...",
  email: "...",
  error: {...},
  timestamp: "2025-12-03T..."
}
```

---

## Key Learnings

1. **API Key Management:** Always sync secrets between Railway and Supabase
2. **Type Flexibility:** Use `Union` types for backward compatibility
3. **Comprehensive Logging:** Log at each pipeline stage
4. **Railway Caching:** Wait 2-3 minutes for deployments to propagate
5. **Error Propagation:** 500 errors might be auth issues, not code bugs

---

## Monitoring Checklist

### After Deployment
- [ ] Check Railway logs for startup errors
- [ ] Verify health endpoint responds
- [ ] Test VAT calculation with known data
- [ ] Confirm no Claude fallback in logs
- [ ] Check rate limiting headers

### Weekly
- [ ] Review error logs for patterns
- [ ] Check Railway resource usage
- [ ] Verify Supabase usage limits
- [ ] Test critical paths manually
