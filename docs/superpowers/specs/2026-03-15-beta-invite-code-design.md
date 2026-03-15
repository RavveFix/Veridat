# Beta Invitation Code System — Design Spec

**Date:** 2026-03-15
**Status:** Approved
**Goal:** Let beta users enter an invitation code during onboarding to automatically receive Pro plan access.

---

## Problem

Veridat needs a way to distribute Pro access to beta testers without manual admin intervention. Codes should be shareable via email, LinkedIn, forums, etc. Users without a code should still be able to sign up with a Free plan.

## Approach: Supabase RPC (SECURITY DEFINER) + Trigger Bypass

The existing `enforce_profiles_plan` trigger prevents clients from modifying the `plan` column. We use a PostgreSQL RPC function with `SECURITY DEFINER` that validates the code and atomically upgrades the user's plan.

**Key insight:** `SECURITY DEFINER` runs as the function owner (postgres), but `auth.role()` inside the trigger does NOT return `'service_role'` in that context. The trigger would silently revert `plan` back to `OLD.plan`. To solve this, the RPC sets a transaction-local config `app.bypass_plan_trigger = 'true'` and the trigger checks for it.

**Why RPC over alternatives:**
- Edge Function: unnecessary overhead, separate deploy
- Trigger exception: couples invite logic into billing security trigger
- RPC: atomic, server-side, no new infrastructure, callable via `supabase.rpc()`

---

## Database Changes

### 1. New table: `beta_invites`

```sql
CREATE TABLE public.beta_invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text UNIQUE NOT NULL,
  label text,                    -- tracking label: "fortnox-forum", "linkedin", etc.
  max_uses int NOT NULL DEFAULT 100,
  current_uses int NOT NULL DEFAULT 0,
  expires_at timestamptz,        -- NULL = never expires
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.beta_invites ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for clients — RPC handles all validation via SECURITY DEFINER.
-- This prevents authenticated users from enumerating valid codes.
```

**Seed data** (insert via Supabase dashboard or SQL editor, not in migration):
```sql
INSERT INTO public.beta_invites (code, label, max_uses) VALUES
  ('VERIDAT-BETA-2026', 'general', 100),
  ('VERIDAT-FORTNOX', 'fortnox-forum', 50),
  ('VERIDAT-EV', 'ev-charging', 50);
```

### 2. New column: `profiles.invited_by_code` + trigger update

```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invited_by_code text;
```

**Update `enforce_profiles_plan` trigger** to:
1. Check `current_setting('app.bypass_plan_trigger', true) = 'true'` — if so, allow the change (used by RPC)
2. Protect `invited_by_code` from client modification (same as `plan`): `NEW.invited_by_code := OLD.invited_by_code;` in UPDATE branch

### 3. RPC function: `redeem_beta_invite`

```sql
CREATE OR REPLACE FUNCTION public.redeem_beta_invite(invite_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_invite_id uuid;
  v_current_uses int;
  v_max_uses int;
  v_expires_at timestamptz;
  v_existing_code text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ej inloggad');
  END IF;

  SELECT invited_by_code INTO v_existing_code
  FROM profiles WHERE id = v_user_id;
  IF v_existing_code IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Du har redan använt en inbjudningskod');
  END IF;

  -- FOR UPDATE: row-level lock prevents race condition on current_uses
  SELECT id, current_uses, max_uses, expires_at
  INTO v_invite_id, v_current_uses, v_max_uses, v_expires_at
  FROM beta_invites
  WHERE code = UPPER(invite_code)
  FOR UPDATE;

  IF v_invite_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ogiltig inbjudningskod');
  END IF;
  IF v_current_uses >= v_max_uses THEN
    RETURN jsonb_build_object('success', false, 'error', 'Inbjudningskoden har nått max antal användningar');
  END IF;
  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Inbjudningskoden har gått ut');
  END IF;

  -- Set transaction-local bypass flag so enforce_profiles_plan trigger allows the change
  PERFORM set_config('app.bypass_plan_trigger', 'true', true);

  UPDATE profiles
  SET plan = 'pro', invited_by_code = UPPER(invite_code)
  WHERE id = v_user_id;

  UPDATE beta_invites
  SET current_uses = current_uses + 1
  WHERE id = v_invite_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Grant execute to authenticated users so supabase.rpc() works
GRANT EXECUTE ON FUNCTION public.redeem_beta_invite(text) TO authenticated;
```

---

## Frontend Changes

### Welcome Modal: New Step "Inbjudningskod"

**File:** `veridat/src/components/onboarding/welcome-modal.tsx`

- `TOTAL_STEPS`: 4 → 5
- New `StepInviteCode` component inserted as step 1
- Existing steps shift: Fortnox → 2, FirstQuestion → 3, Done → 4

**Step flow:**
```
Step 0: Välkommen
Step 1: Inbjudningskod (NEW)
Step 2: Fortnox-anslutning
Step 3: Prova fråga
Step 4: Klar
```

**StepInviteCode component:**
- Icon: `Ticket` from lucide-react
- Heading: "Har du en inbjudningskod?"
- Subtext: "Om du fått en beta-kod, ange den här för att få tillgång till alla funktioner."
- Input: placeholder "T.ex. VERIDAT-BETA-2026"
- Button: "Aktivera" → `supabase.rpc('redeem_beta_invite', { invite_code: code.toUpperCase() })`
- Loading state: disabled button + spinner
- Success: green check + "Välkommen till Veridat Beta! Du har Pro-access." + auto-advance 2s
- Error: red text below input
- Skip: "Hoppa över" link (continues as Free)

**Supabase client:** Use `createBrowserClient()` from `@supabase/ssr` inside the component.

**Plan state flow:** The modal needs to know the user's plan for the Fortnox step messaging. Add a local state `isPro` to `WelcomeModal` that starts as the prop value and gets set to `true` on successful code redemption. Pass it to `StepFortnox`.

### Fortnox Step: Free Plan Messaging

Current RLS: `fortnox_tokens` INSERT requires `plan IN ('pro', 'trial')`.

**Decision:** Keep security boundary. Show message in Fortnox step for Free users:
"Ange en inbjudningskod i föregående steg för att koppla Fortnox."

The invite step comes before Fortnox, so users with valid codes are already Pro.

---

## Tracking

```sql
SELECT invited_by_code, COUNT(*) FROM profiles
WHERE invited_by_code IS NOT NULL GROUP BY invited_by_code;
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/20260315000001_beta_invites.sql` | CREATE | Table + RLS + RPC + profiles column + trigger update |
| `veridat/src/components/onboarding/welcome-modal.tsx` | MODIFY | Add StepInviteCode, update step count, Fortnox message |

---

## Validation Checklist

- [ ] Valid code → plan = 'pro', invited_by_code set, current_uses incremented
- [ ] Invalid code → error message, plan stays 'free'
- [ ] No code (skip) → plan = 'free', no blocking
- [ ] Expired code → error message
- [ ] Maxed-out code → error message
- [ ] Double-redemption → error ("redan använt")
- [ ] Case insensitive → "veridat-beta-2026" works
- [ ] Fortnox step shows helpful message for Free users
- [ ] Build passes