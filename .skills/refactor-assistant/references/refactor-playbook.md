# Refactor Playbook (v1)

Denna playbook styr hur `$refactor-assistant` genomfor sma, sakra refactors i frontend-PR:er.

## Tillatna refactors

- Extrahera ren hjalpfunktion (ingen ny extern bieffekt).
- Ta bort duplicerad logik inom scope.
- Forenkla villkor utan beteendeforandring.
- Bryt ut liten lokal subcomponent/helper nar det minskar komplexitet.

## Ej tillatna refactors i v1

- API-kontraktsandringar (request/response, publika interfaces, event payloads).
- Breda arkitekturskiften over flera lager.
- Andringar i backend, Supabase Edge Functions eller Python-kod.
- Omfattande filflyttar som forsvagar PR-sporbarhet.

## Guardrails

- Max 3 andrade kallbacksfiler per korning.
- Max 200 diff-rader totalt (add + del).
- Scope ar endast `apps/web/src` och `.ts/.tsx`.
- Stanna och rapportera risk om andring bryter guardrails.

## Prioriteringsregel

Anvand hotspot-score:

`score = changed_lines*3 + min(total_lines, 2000)/20`

Prioritera:
1. Hogst score.
1. Produktionskod fore tester vid jamn score.
1. Kandidater med lag regressionsrisk.

## Verifieringsregel (obligatorisk)

1. Kor alltid `npm run build`.
1. Kor berorda tester:
   - Matchande `*.test.ts`/`*.test.tsx` i samma path.
   - Fallback till `apps/web/src/utils/*.test.ts` om utils berors och inga direkta tester finns.
   - Fallback till `npm test` om inga berorda tester hittas.
1. Markera aldrig arbetet som klart om verifiering fallerar.

## Rapportmall (svenska)

Rapportera alltid med dessa sektioner:

1. `Mal`
1. `Valda hotspots`
1. `Gjorda andringar`
1. `Verifiering`
1. `Risker`
1. `Rekommenderad nasta refactor`
