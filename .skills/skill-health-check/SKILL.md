---
name: skill-health-check
description: Veckovisa hälsokontroller för lokala Codex-skills. Använd när du vill skanna skill-mappar för valideringsfel, saknad agents/openai.yaml, överlånga SKILL.md, att-göra-markörer eller annan hygien, och producera en rapport utan att ändra filer.
---

# Skill Health Check

## Översikt
Genomför en lättviktig kvalitetskontroll av skills och leverera en tydlig rapport med fel, varningar och förbättringsförslag utan att göra automatiska ändringar.

## Snabbstart
Kör skriptet och få en Markdown‑rapport på stdout:

```bash
python3 .skills/skill-health-check/scripts/skill_health_check.py
```

Spara rapport till fil:

```bash
python3 .skills/skill-health-check/scripts/skill_health_check.py --out .skills/skill-health-check/reports/$(date +%F).md
```

## Scope
Som standard skannar skriptet:
- `.skills` i repot
- `$CODEX_HOME/skills` (fallback `~/.codex/skills`)

Vill du styra scope, använd `--roots`:

```bash
python3 .skills/skill-health-check/scripts/skill_health_check.py --roots .skills,~/.codex/skills
```

## Kontroller som görs
- Kör `quick_validate.py` om den finns
- Verifierar frontmatter (`name`, `description`)
- Flaggar om frontmatter‑namn inte matchar mappnamn
- Letar efter att-göra‑markörer i `SKILL.md`
- Varnar om `SKILL.md` överstiger 500 rader
- Varnar om `agents/openai.yaml` saknas

## Output‑krav
Rapporten ska vara en Markdown‑fil med:
- Sammanfattning (antal skills, fel, varningar)
- Lista av skills utan anmärkning
- Detaljerade findings per skill med kort kontext

## Guardrails
- Ändra aldrig filer automatiskt
- Om förbättringar behövs: föreslå patchar, men vänta på godkännande
