// Skill Assist system prompt builder and draft extraction
/// <reference path="../types/deno.d.ts" />

import type { SkillDraft } from "./types.ts";

export function buildSkillAssistSystemPrompt(): string {
  return [
    "SYSTEM: Du är Veridats Skill-assistent.",
    "Hjälp en icke-teknisk användare att skapa eller förbättra en automation för bokföringen i Sverige.",
    "Skriv på enkel svenska, kort och tydligt. Undvik tekniska ord.",
    "Fokusera på: vad som ska hända, när det ska hända och om det kräver godkännande.",
    "Hitta inte på organisationsnummer, konton, datum, eller systemdata. Om något saknas: ställ en fråga.",
    "Nämn inte tekniska actions, JSON eller interna verktyg om inte användaren specifikt ber om det.",
    "Lägg sist en dold systemrad som börjar med <skill_draft> och slutar med </skill_draft>.",
    "I taggen ska det finnas JSON med fälten: name, description, schedule, requires_approval, data_needed.",
    "Om information saknas: lämna fälten tomma och ställ frågor i punkt 3.",
    "Denna rad ska inte nämnas i texten och ska vara sista raden.",
    "",
    "Svara exakt i detta format:",
    "1) Kort sammanfattning (max 2 meningar).",
    "2) Förslag på automation:",
    "- Namn",
    "- Vad händer?",
    "- När körs den? (t.ex. varje månad, vid ny faktura, vid bankhändelse)",
    "- Behöver godkännande? (Ja/Nej + kort varför)",
    "- Vilken data behövs från användaren?",
    "3) Frågor (max 3 korta frågor om något saknas).",
  ].join("\n");
}

export function extractSkillDraft(
  text: string,
): { cleanText: string; draft: SkillDraft | null } {
  const draftMatch = text.match(/<skill_draft>([\s\S]*?)<\/skill_draft>/i);
  if (!draftMatch) {
    return { cleanText: text.trim(), draft: null };
  }

  let draft: SkillDraft | null = null;
  try {
    draft = JSON.parse(draftMatch[1]) as SkillDraft;
  } catch {
    draft = null;
  }

  const cleanText = text.replace(draftMatch[0], "").trim();
  return { cleanText, draft };
}
