# Verbouw planner

Interactieve tool om je verbouwing te tekenen en te onthouden: muren tekenen
(automatisch aan elkaar gekoppeld op hoekpunten), vrije zones (ook L-vormig),
ramen/deuren met automatische netto-m² berekening, meerdere plattegronden
(bv. begane grond + verdieping) los in dezelfde ruimte plaatsen, pannen/zoomen,
en foto's + notities per muur of zone.

## Lokaal draaien

Vereist Node.js (18 of hoger).

```
npm install
npm run dev
```

Open daarna http://localhost:3000 in je browser.

Sla je bestanden op je pc op, overschrijf de bestaande bestanden in deze map,
en herstart (of refresh gewoon) `npm run dev` — Next.js herlaadt automatisch
bij wijzigingen.

## Data & backup

Alles wordt lokaal in je browser bewaard via IndexedDB (robuuster dan
localStorage, overleeft de meeste "wis browsergegevens"-acties, maar niet een
volledige herinstallatie van je browser of een ander apparaat). Gebruik de
knop **Backup downloaden** in de werkbalk regelmatig om een JSON-bestand met
al je data (inclusief foto's) te bewaren, en **Backup herstellen** om het
terug te zetten.

## Vercel-ready

Dit is een gewone Next.js-app (App Router), dus:

```
git init
git add .
git commit -m "verbouw planner"
```

Push naar GitHub en importeer het repo op vercel.com — geen extra configuratie
nodig, Vercel herkent Next.js automatisch.

**Let op:** de opslag (IndexedDB) is op dit moment per browser/apparaat. Als
je het straks met anderen wil delen zodat iedereen dezelfde data ziet, is dat
een vervolgstap: dan vervangen we de `lib/db.js`-laag door API-routes die naar
een echte database schrijven (bv. Vercel Postgres of Supabase). De rest van de
app hoeft daarvoor niet te veranderen.

## Structuur

- `app/` — Next.js pagina's (App Router)
- `components/Planner.jsx` — de hele tekentool (canvas, muren, zones, foto's)
- `lib/db.js` — opslaglaag (nu IndexedDB, later eventueel een database-API)