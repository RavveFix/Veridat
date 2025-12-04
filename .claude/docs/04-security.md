# Security Guide

## CORS Headers

All Edge Functions require CORS headers:
```typescript
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-id",
};

// Handle OPTIONS preflight
if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
}
```

---

## Rate Limiting

### Implementation
- User ID extracted from `x-user-id` header or Authorization token
- Falls back to 'anonymous' if not provided
- Fails open (allows request) if rate limiting service errors

### Limits
- **Hourly:** 10 requests/hour
- **Daily:** 50 requests/day

### Response Headers
```
X-RateLimit-Remaining: 5
X-RateLimit-Reset: 1701648000
```

### 429 Response
```json
{
  "error": "Rate limit exceeded",
  "message": "You have exceeded your hourly/daily limit"
}
```

---

## API Key Security

### Timing Attack Protection (`python-api/app/core/security.py`)
```python
import secrets

# Constant-time comparison prevents timing attacks
def verify_api_key(provided_key: str, expected_key: str) -> bool:
    return secrets.compare_digest(provided_key, expected_key)
```

### Fail-Open Design
- If `PYTHON_API_KEY` not configured, authentication is bypassed
- Allows development without API key setup
- Production MUST have `PYTHON_API_KEY` set

---

## Row-Level Security (RLS)

### fortnox_tokens Table
```sql
-- Users can only access their own tokens
CREATE POLICY "Users can access own tokens"
ON fortnox_tokens
FOR ALL
USING (auth.uid() = user_id);
```

### api_usage Table
```sql
-- Users can only see their own usage
CREATE POLICY "Users can access own usage"
ON api_usage
FOR ALL
USING (auth.uid() = user_id);
```

---

## Secrets Management

### Supabase Secrets
```bash
# Set secrets (never commit to git)
supabase secrets set GEMINI_API_KEY=...
supabase secrets set PYTHON_API_URL=https://...
supabase secrets set PYTHON_API_KEY=...
supabase secrets set FORTNOX_CLIENT_ID=...
supabase secrets set FORTNOX_CLIENT_SECRET=...

# List secrets (values hidden)
supabase secrets list
```

### Railway Environment Variables
Set in Railway dashboard:
- `ENV=production`
- `DEBUG=false`
- `ALLOWED_ORIGINS=https://...`
- `PYTHON_API_KEY=...`

### Frontend (.env)
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**NEVER commit:**
- `.env` files
- API keys in code
- Tokens or passwords

---

## Error Handling

### Don't Leak Sensitive Information
```typescript
// BAD - leaks internal details
return new Response(JSON.stringify({ error: error.stack }));

// GOOD - safe error message
return new Response(JSON.stringify({
  error: "internal_error",
  message: "An error occurred processing your request"
}));
```

### Error Source Tracking
```typescript
{
  error: "python_api_error",
  message: "Python API error (400): Invalid request",
  source: "python_api",        // or "edge_function"
  details: { status_code: 400 }
}
```

---

## Security Checklist

### Pre-Commit
- [ ] No hardcoded API keys
- [ ] No secrets in logs
- [ ] No `.env` files staged

### Edge Functions
- [ ] CORS headers present
- [ ] OPTIONS preflight handled
- [ ] Rate limiting applied
- [ ] User ID validation

### Database
- [ ] RLS enabled on all tables
- [ ] User-scoped queries
- [ ] No public access to sensitive data

### Python API
- [ ] `DEBUG=false` in production
- [ ] `ALLOWED_ORIGINS` restricted
- [ ] Timing-safe API key comparison
- [ ] Input validation on all endpoints

### Authentication
- [ ] JWT token validation
- [ ] Token expiration checked
- [ ] Refresh token rotation
