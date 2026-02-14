---
name: refactor-assistant
description: PR-driven frontend refactoring assistant for Veridat. Use when you explicitly invoke $refactor-assistant to identify and implement small, reversible refactors in changed TypeScript/TSX files under apps/web/src, prioritize hotspots from git diff data, run mandatory verification (npm run build plus relevant tests), and produce a Swedish refactor report with risks and next step.
---

# Refactor Assistant

Denna skill ar for intern utveckling i PR-flode och aktiveras explicit med `$refactor-assistant`.

## Scope och guardrails

- Arbeta endast i `apps/web/src`.
- Arbeta endast med `.ts` och `.tsx`.
- Arbeta endast i filer som ar andrade i vald diff (`base..head`).
- Gor sma, reversibla andringar:
  - Max 3 filer per korning.
  - Max 200 diff-rader totalt (add + del).
- Markera aldrig arbetet som klart om verifiering misslyckas.

Las `references/refactor-playbook.md` innan patchning.

## Arbetsflode (fast ordning)

1. Las diff
1. Kor hotspot-ranking
1. Valj toppkandidater
1. Gor sma refactor-patchar
1. Kor verifiering
1. Rapportera pa svenska

## 1) Las diff

Anvand `git diff --name-only --no-renames <base> <head>` for att identifiera andrade filer.

## 2) Kor hotspot-ranking

Kor:

```bash
python3 .skills/refactor-assistant/scripts/pr_hotspot_rank.py \
  --base origin/main \
  --head HEAD \
  --limit 5 \
  --format markdown
```

Scriptet rankar kandidater med:

`score = changed_lines*3 + min(total_lines, 2000)/20`

## 3) Valj toppkandidater

- Prioritera hogst score.
- Prioritera produktionskod fore tester om score ar snarlik.
- Hoppa over kandidater som driver andringen utanfor guardrails.

## 4) Gor sma refactor-patchar

Tillatna refactors:

- Extrahera ren hjalpfunktion.
- Ta bort duplicerad logik.
- Forenkla villkor utan beteendeforandring.
- Bryta ut liten lokal subcomponent eller helper.

Ej tillatet i v1:

- API-kontraktsandringar.
- Breda arkitekturskiften.
- Backend-, Edge Function- eller Python-andringar.

## 5) Kor verifiering

Alltid:

```bash
npm run build
```

Berorda tester:

1. For varje andrad kallbacksfil, kor matchande `*.test.ts` eller `*.test.tsx` i samma path om fil finns.
1. Om inga direkta tester finns och `apps/web/src/utils` berors, kor util-tester:

```bash
npm test -- apps/web/src/utils/*.test.ts
```

3. Om inga berorda tester hittas alls, fallback:

```bash
npm test
```

## 6) Rapportera pa svenska (obligatorisk mall)

Rapporten ska alltid innehalla:

1. `Mal`
1. `Valda hotspots`
1. `Gjorda andringar`
1. `Verifiering`
1. `Risker`
1. `Rekommenderad nasta refactor`

## Snabbkommando for JSON-output

```bash
python3 .skills/refactor-assistant/scripts/pr_hotspot_rank.py \
  --base origin/main \
  --head HEAD \
  --limit 5 \
  --format json
```
