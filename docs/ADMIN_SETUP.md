# Admin Portal Setup Checklist

Use this when enabling or troubleshooting the admin billing portal.

## 1) Deploy the admin function

The admin UI talks to the `admin-billing` Edge Function. It must accept OPTIONS preflight, so disable gateway JWT verification.

```bash
supabase functions deploy admin-billing --project-ref <project-ref> --no-verify-jwt
```

Keep this in sync locally:

```toml
[functions.admin-billing]
verify_jwt = false
```

## 2) Grant admin access

The `profiles` table enforces billing fields unless you use a service role claim. Run this in the Supabase SQL editor.

```sql
begin;
select set_config('request.jwt.claim.role','service_role', true);

update public.profiles
set is_admin = true
where id = (select id from auth.users where email = 'you@domain.se');

commit;
```

If the profile row is missing, use insert‑or‑update:

```sql
insert into public.profiles (id, full_name, plan, billing_status, billing_provider, is_admin)
select id,
       coalesce(raw_user_meta_data->>'full_name',''),
       'free','active','manual', true
from auth.users
where email = 'you@domain.se'
on conflict (id) do update
set is_admin = true;
```

## 3) Allow login redirects

Add these to Supabase Auth → URL Configuration → Redirect URLs:

- `https://veridat.vercel.app/**`
- `https://staging.veridat.se/**`

If you use another preview domain, add that too or you will be redirected to `/login` without session.

## 4) Staging domain (optional)

If staging is a Vercel alias:

```bash
vercel alias set <deployment>.vercel.app staging.veridat.se
```

## 5) Sanity checks

Use these quick tests when debugging:

1. `https://staging.veridat.se/login?next=/admin` should keep you on `/admin`.
2. If you see 403 on `admin-billing`, confirm `is_admin = true`.
3. If you see CORS/OPTIONS errors, confirm `verify_jwt = false` for `admin-billing` and redeploy.
