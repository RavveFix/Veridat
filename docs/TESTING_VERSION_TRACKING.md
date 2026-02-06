# Quick Test Guide: Version Tracking

## ✅ Deployment Complete

- Database migration applied to Supabase Cloud
- Version tracking är live (consent‑mejl inaktiverat)

## Quick Manual Test

### Test 1: Check Version Display (30 seconds)

1. Open the app in incognito/private browsing
2. Navigate to `/login.html`
3. **Look for:** Version number in consent modal footer: "Villkorsversion: 1.0.0"
4. Accept terms and log in
5. **Check browser console** for att inga fel visas

### Test 2: Verify Database (SQL Query)

Run this in your Supabase SQL Editor:

```sql
-- Check if migration applied correctly
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
  AND column_name IN ('terms_version', 'consent_email_sent', 'consent_email_sent_at');

-- Should return 3 rows

-- Check terms_versions table
SELECT * FROM terms_versions;
-- Should show version 1.0.0

-- Check a user's consent data
SELECT full_name, has_accepted_terms, terms_version, 
       consent_email_sent, consent_email_sent_at
FROM profiles 
LIMIT 1;
```

### Test 3: Simulate Version Upgrade

1. **Update the version:**
   - Edit `src/constants/termsVersion.ts`
   - Change `CURRENT_TERMS_VERSION` from `"1.0.0"` to `"1.1.0"`
   - Save and wait for Vite hot reload

2. **Refresh the app** (if already logged in)

3. **Expected:** Modal should appear asking for re-consent

4. **Verify console logs:** "Terms version outdated, user needs to re-consent"

## Important Notes

### Email Sending
Consent‑mejl är för närvarande inaktiverat (ingen e‑postleverantör). Om e‑post återinförs behöver en ny leverantör konfigureras och en ny funktion implementeras.

## Troubleshooting

**Modal doesn't show version:**
- Check browser console for errors
- Verify `termsVersion.ts` is imported correctly
- Hard refresh (Cmd+Shift+R)

**Re-consent not triggering:**
- Verify version was actually changed
- Clear browser cache/hard refresh
- Check database: user's `terms_version` should be outdated

## Production Deployment Checklist

- [x] Database migration pushed
- [x] Edge Function deployed

---

**Everything is deployed and ready to test! 🎉**
