---
name: platform-seo
description: SEO for Veridat web platform (SaaS bookkeeping + AI automation). Use when auditing or improving meta titles/descriptions, OG/Twitter tags, schema.org, canonical/robots/sitemaps, internal linking, performance/Core Web Vitals, and content briefs for the Swedish market, using repo-specific file locations and GSC/GA insights.
---

# Platform SEO

## Översikt
Sköt SEO-arbete för Veridat med fokus på svenska sökintent, YMYL-tillitssignaler och teknisk hälsa i den här koden.

## Arbetsflöde
1. Samla input
2. Kartlägg relevanta filer
3. Säkerställ on-page metadata
4. Validera structured data
5. Uppdatera sitemap och robots
6. Kör teknisk audit
7. Förbättra internlänkning
8. Optimera prestanda
9. Leverera content briefs
10. Etablera mätning

## 1. Samla input
- Be om brand-guidelines, keyword-listor, målgrupper och prioriterade erbjudanden.
- Om material saknas i repo, be användaren att dela filer eller text. Lägg därefter till dem i `.skills/platform-seo/references/` som `brand-guidelines.md` och `keyword-list.md`.
- Be om GSC/GA-export eller skärmdumpar för senaste 3-6 månaderna.

## 2. Kartlägg relevanta filer
- Läs `references/repo-map.md` för en snabb karta över SEO-relevanta filer.

## 3. Säkerställ on-page metadata
- Säkerställ unika `<title>` och `<meta name="description">` för alla indexerbara sidor.
- Håll titlar och beskrivningar på svenska och i linje med primära keywords utan keyword stuffing.
- Säkerställ canonical för publika sidor.
- Kontrollera OG/Twitter-taggar för delning.
- För app-sidor som inte ska ranka (login/admin/app), bekräfta med användaren och lägg `noindex` i HTML eller headers.

## 4. Validera structured data
- Behåll och uppdatera `SoftwareApplication` och `Organization` i `apps/web/index.html`.
- Lägg `inLanguage: "sv-SE"` och verifiera att `offers` och `aggregateRating` är korrekta. Ta bort rating om den inte kan verifieras.

## 5. Uppdatera sitemap och robots
- Uppdatera `apps/web/public/sitemap.xml` med alla indexerbara URL:er.
- Låt `apps/web/public/robots.txt` vara enkel och låt crawl gälla publikt innehåll.

## 6. Kör teknisk audit
- Kontrollera crawlbarhet, statuskoder, omdirigeringar och duplicerade URL:er.
- Säkerställ att indexerbart innehåll finns i HTML-utgången för landningssidan.
- Kontrollera H1/H2-struktur och att bara en H1 används per sida.

## 7. Förbättra internlänkning
- Lägg kontextuella länkar mellan relevanta sektioner och sidor.
- Använd beskrivande ankartexter som speglar sökintention.

## 8. Optimera prestanda
- Kör Lighthouse eller PageSpeed Insights och fokusera på LCP, INP och CLS.
- Prioritera bildoptimering, minskad JS-kostnad och font-strategi.

## 9. Leverera content briefs
- Använd `assets/content-brief-template.md` som mall.
- Skapa briefs för nya landningssidor eller artiklar med tydlig intent, rubrikstruktur och CTA.

## 10. Etablera mätning
- Använd GSC för indexstatus, queries och CTR; GA för konverteringsflöden.
- Dokumentera baseline före ändringar och följ upp 2-4 veckor efter release.

## Leverabler
- Lista på ändringar per fil
- Metadata-tabell per sida
- Uppdaterad sitemap/robots
- Schema.org-diff
- Internlänkningsförslag
- Prestandaåtgärder
- 1+ content briefs

## Resurser
- `references/repo-map.md`
- `references/seo-checklist.md`
- `assets/content-brief-template.md`
