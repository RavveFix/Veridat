# Plan

## Beslut (billing & access)
- Fakturaperiod: 30 dagar.
- Grace period: 14 dagar med full Pro‑access.
- Nedgradering sker efter periodens slut + grace.
- Trial: 14 dagar, endast admin‑styrt i särskilda fall.
- Pro via admin‑invite gäller direkt, faktura skickas efteråt.

## Kontomodell (minimum viable)
- Plan: `free`, `pro`, `trial`.
- Billingstatus: `active`, `past_due`, `suspended`.
- Datumfält: `period_end`, `grace_until`, `trial_end`.
- Faktura (manuell): `invoice_id`, `invoice_due_date`, `paid_at`.
- Provider: `manual` nu, `stripe` senare.

## Adminportal MVP (första version)
- Översikt: antal `pro`, `free`, `trial`, `past_due`.
- Lista på konton: plan, status, periodslut, faktura.
- Åtgärder: bjud in, ge Pro, ge Trial, markera betald, nedgradera.
- Policy‑kort: visa nuvarande regler för period/grace/trial.

## Fortnox‑flöde (manuell hantering)
- Admin skapar Pro‑period med `period_end = +30 dagar`.
- Faktura skapas i Fortnox och kopplas till kontot (lägg in `invoice_id`).
- Om ingen betalning vid `period_end`: sätt `past_due` och `grace_until = +14 dagar`.
- Efter grace: sätt `free` och `suspended` (eller enbart `free` om ni vill mjukare fallback).

## Stripe‑beredskap (senare)
- Samma fält mappas direkt till Stripe‑webhooks.
- `external_subscription_id` används när Stripe aktiveras.
- `billing_status` hålls i sync via webhook events.

## Byggordning
1. Adminportal UI med statiska data och tydliga states.
2. Datamodell i DB (t.ex. `subscriptions` + koppling till `profiles`).
3. Admin‑API: skapa/ändra plan, markera betald, sätt period.
4. Fortnox‑koppling: skapa faktura + uppdatera status manuellt.
5. Automatiska jobb: periodslut, grace‑utgång, notiser.

## Bankmatchning & svensk redovisningssed (Hybrid‑läge)
### Säkerhetsprinciper
- All bokföring sker via tydligt OK‑flöde under inlärningsperiod.
- Spårbar logg på varje beslut (BFL 7 kap: verifikation + vem).
- Auto‑läge aktiveras först efter upprepade manuella godkännanden per motpart.
- Ångra/avvisa ska alltid vara möjligt.

### Sprint (nästa steg)
- Match‑confidence och “varför”-text i bankmatch‑vyn.
- Spårbar logg vid OK (audit‑trail).
- Policy‑tabell för inlärning per motpart (approved_count, auto_enabled).
- Uppdatera policy vid varje OK (men håll auto avstängt som default).
