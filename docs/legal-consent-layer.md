# Legal Consent Layer

## Overview

Veridat implements a comprehensive legal consent system to ensure GDPR compliance and transparency about AI usage. Users must explicitly accept terms and provide their full name before accessing the application.

## Architecture

### Two-Stage Consent Flow

1. **Login Page (Pre-Authentication)**
   - User must check consent box and enter full name on `/login.html`
   - Consent + name are stored locally (device-level) before magic-link sign-in
   - Prevents access to app until consent is completed

2. **App Page (Post-Authentication)**
   - Syncs local consent to database
   - Sync sker helt tyst i bakgrunden (ingen toast/notis)
   - Fallback: Shows modal if no local or DB record exists

### Components

#### `LegalConsentModal.tsx`
Located in `src/components/LegalConsentModal.tsx`

**Props:**
- `mode: 'authenticated' | 'local'` - Determines behavior
- `onAccepted: (fullName: string) => void` - Callback with user's name

**Modes:**
- **`local`**: Used on login page. Saves to `localStorage` only.
- **`authenticated`**: Used in app. Saves to Supabase `profiles` table.

**Features:**
- Full name input (required)
- Disabled "Accept" button until name is entered
- Links to `/privacy.html` and `/terms.html`
- AI disclaimer and GDPR information

## Data Flow

### New User Journey

```mermaid
sequenceDiagram
    participant User
    participant LoginPage
    participant LocalStorage
    participant Supabase
    participant AppPage

    User->>LoginPage: Visit /login.html
    LoginPage->>User: Show consent checkbox + name field
    User->>LoginPage: Check consent + enter name
    LoginPage->>LocalStorage: Save consent + name
    User->>Supabase: Sign in (magic link)
    Supabase->>AppPage: Redirect to /app/
    AppPage->>LocalStorage: Read local consent
    AppPage->>Supabase: Sync to profiles table
    AppPage->>User: Show app (consent complete)
```

### Returning User

```mermaid
sequenceDiagram
    participant User
    participant AppPage
    participant Supabase

    User->>AppPage: Visit /app/
    AppPage->>Supabase: Check profiles.has_accepted_terms
    alt Terms accepted
        AppPage->>User: Show app
    else Terms not accepted
        AppPage->>User: Show LegalConsentModal
    end
```

## Database Schema

### `profiles` Table

```sql
create table profiles (
  id uuid references auth.users not null primary key,
  has_accepted_terms boolean default false,
  terms_accepted_at timestamp with time zone,
  full_name text,
  -- other fields...
);
```

**Key Fields:**
- `has_accepted_terms`: Boolean flag
- `terms_accepted_at`: ISO timestamp for audit trail
- `full_name`: User's full name (required for acceptance)

## Local Storage

**Keys:**
- `has_accepted_terms_local`: `"true"` if accepted on login page
- `user_full_name_local`: User's full name
- `terms_accepted_at_local`: ISO timestamp

## Implementation Details

### Login Page (`src/login.ts`)

```typescript
// User must accept terms + provide full name before sending magic link
if (!consentCheckbox.checked) return;
if (!fullName) return;

localStorage.setItem('has_accepted_terms_local', 'true');
localStorage.setItem('user_full_name_local', fullName);
localStorage.setItem('terms_accepted_at_local', new Date().toISOString());
localStorage.setItem('terms_version_local', CURRENT_TERMS_VERSION);
```

### App Page (`src/main.ts`)

```typescript
if (!hasAccepted) {
    // Check for local consent
    const localConsent = localStorage.getItem('has_accepted_terms_local');
    const localName = localStorage.getItem('user_full_name_local');
    const localTime = localStorage.getItem('terms_accepted_at_local');

    if (localConsent && localName) {
        // Sync to DB
        await supabase.from('profiles').upsert({
            id: session.user.id,
            has_accepted_terms: true,
            terms_accepted_at: localTime,
            full_name: localName
        });
    } else {
        // Show modal in authenticated mode
    }
}
```

## Legal Pages

### Privacy Policy (`privacy.html`)
- GDPR-compliant privacy policy
- Details data collection and AI usage
- User rights (access, deletion, etc.)

### Terms of Service (`terms.html`)
- Terms of use
- AI disclaimer and liability limitations
- User responsibilities

## GDPR Compliance

### Key Aspects

1. **Explicit Consent**: Modal blocks access until user actively clicks "Accept"
2. **Informed Consent**: Full legal text available before acceptance
3. **Audit Trail**: Timestamp and name stored for legal record
4. **User Rights**: Privacy policy details GDPR rights
5. **No Pre-Checked Boxes**: User must actively input name and click accept

### Data Retention

- Consent records stored indefinitely for legal compliance
- Linked to user account via `profiles.id` → `auth.users.id`

## Testing

### Manual Test (Login Flow)

1. Clear `localStorage`: `localStorage.clear()`
2. Navigate to `/login.html`
3. Verify full name + email fields are disabled until consent checkbox is checked
4. Check consent box and enter full name + email
5. Submit and verify magic link is sent, form hides
6. Open the magic link and log in
7. Verify consent syncs to DB and local consent keys are cleared

### Verify Database

```sql
-- Check if consent was saved
SELECT full_name, has_accepted_terms, terms_accepted_at 
FROM profiles 
WHERE id = '<user_id>';
```

## Common Issues

### Modal Not Appearing on Login
- Check browser console for errors
- Verify `LegalConsentModal.tsx` is imported correctly
- Clear cache and localStorage

### Consent Not Syncing to DB
- Check Supabase RLS policies on `profiles` table
- Verify user is authenticated
- Check network tab for 406/403 errors

### Multiple Modals
- Ensure only one modal container exists
- Check for duplicate `mountPreactComponent` calls

## Future Enhancements

- [ ] Email confirmation with consent summary
- [x] Version tracking for terms (re-consent on updates)
- [ ] Admin dashboard for consent analytics
- [ ] Multi-language support for legal text

## Recent Updates (December 2025)

### Version Tracking System
- Added `terms_version` field to profiles table
- Created `terms_versions` audit table for version history
- Implemented automatic version checking on user login
- Users are prompted to re-consent when terms are updated
- Version displayed in consent modal footer

### Email Confirmation
- Consent-mejl är inaktiverat (e-post borttaget).
- Om e-post återinförs behövs ny leverantör och uppdaterad funktion.

### Production Deployment: Vercel

**File:** `vercel.json`

The platform is configured for clean, production-ready URLs using Vercel rewrites.

#### URL Structure

**Development:**
- `http://localhost:5173/login.html` ✅
- `http://localhost:5173/app/index.html` ✅

**Production:**
- `https://yourdomain.com/login` 🎯
- `https://yourdomain.com/app` 🎯
- `https://yourdomain.com/privacy` 🎯
- `https://yourdomain.com/terms` 🎯

#### Vercel Configuration

```json
{
  "rewrites": [
    { "source": "/login", "destination": "/login.html" },
    { "source": "/app", "destination": "/app/index.html" },
    { "source": "/privacy", "destination": "/privacy.html" },
    { "source": "/terms", "destination": "/terms.html" }
  ],
  // ... headers
}
```

#### Vite Configuration (Local Development)

To ensure clean URLs work locally (matching production), a custom middleware was added to `vite.config.ts`:

```typescript
plugins: [
    preact(),
    {
        name: 'html-rewrite',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url === '/login') req.url = '/login.html';
                else if (req.url === '/app') req.url = '/app/index.html';
                else if (req.url === '/privacy') req.url = '/privacy.html';
                else if (req.url === '/terms') req.url = '/terms.html';
                next();
            });
        },
    },
],
```

**Security Headers:**
- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-XSS-Protection: 1; mode=block` - Enables XSS filtering

#### Code Updates for Clean URLs

All internal redirects updated to use clean paths:
- `window.location.href = '/login'` (not `/login.html`)
- `window.location.href = '/app'` (not `/app/`)
- Email redirect: `emailRedirectTo: origin + '/app'`

**Files Modified:**
- `src/components/LegalConsentModal.tsx`
- `src/main.ts`
- `src/login.ts`
- `src/landing/App.tsx`
- `src/landing/components/Hero.tsx`

### Technical Details
- Version constant: `src/constants/termsVersion.ts`
- Migration: `20251201000001_add_terms_versioning.sql`
- Deployment config: `vercel.json`

### Deployment Checklist

**Database:**
- [x] Migration applied to Supabase Cloud
- [x] `terms_versions` table created with initial version 1.0.0
- [x] `profiles` table extended with version tracking fields

**Hosting:**
- [x] Vercel configuration created
- [x] Clean URLs configured with rewrites
- [x] Security headers added
- [x] Code updated to use clean paths

### Monitoring & Maintenance

- Övervaka consent-flöden via applikationsloggar och Supabase-profiler.
