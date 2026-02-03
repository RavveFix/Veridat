# Pre-prod checklist (short)

Use this after local validation and before production deploy.

## Auth and login
1. Log in with magic link and confirm redirect to `/app`.
2. Confirm consent email can be sent and received.

## File security
1. Upload a PDF and an Excel file.
2. Reopen each file from the UI.
3. Verify the file URL is signed and not publicly accessible.

## Fortnox integration
1. Connect Fortnox via OAuth.
2. Run one safe read action (customers or articles).
3. Verify it targets the correct account.

## AI and memory
1. Send a few messages.
2. Wait 30 seconds and confirm memories generate without errors.
3. Open the search modal and verify it returns results.

## Rate limiting sanity
1. Trigger the consent email twice quickly.
2. Confirm the second request is rate limited.

## Storage policies
1. Ensure `chat-files` and `excel-files` buckets are not public.
2. Confirm users can only see their own files.

## Deploy order
1. Deploy frontend first.
2. Deploy Edge Functions.
3. Apply storage lockdown migration last.
