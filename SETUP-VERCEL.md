# Verbouw planner live zetten (Vercel + Neon)

## Wat je krijgt
- Een openbare link naar de app
- Een **deellink** naar *jouw project* (iedereen met de link kan lezen én schrijven)
- Een **groen lampje** bovenaan als iemand anders hetzelfde project open heeft

---

## Stap 1 – Code op GitHub

1. Ga naar [github.com](https://github.com) → **New repository**
2. Naam bijv. `verbouw-planner`, **Public**, géén README aanvinken
3. Op je computer, in de projectmap:

```bash
git init
git add .
git commit -m "Verbouw planner met cloud delen"
git branch -M main
git remote add origin https://github.com/JOUW-GITHUB-NAAM/verbouw-planner.git
git push -u origin main
```

(Vervang `JOUW-GITHUB-NAAM`.)

---

## Stap 2 – Project op Vercel

1. Ga naar [vercel.com](https://vercel.com) → log in **met GitHub**
2. **Add New… → Project**
3. Importeer `verbouw-planner`
4. Framework: Next.js (automatisch)
5. Klik **Deploy** (dit mag de eerste keer nog falen zolang de database ontbreekt – dat is ok)

Je krijgt een URL zoals `https://verbouw-planner.vercel.app`

---

## Stap 3 – Neon database koppelen

### Optie A (makkelijkst): via Vercel

1. In je Vercel-project → **Storage** (of **Integrations**)
2. Zoek **Neon** → **Add** / Connect
3. Maak een database (regio Europa als je die ziet)
4. Vercel zet automatisch `DATABASE_URL` in je Environment Variables

### Optie B: via neon.tech

1. Account op [neon.tech](https://neon.tech)
2. Create project → kopieer de connection string
3. In Vercel → Project → **Settings → Environment Variables**
4. Naam: `DATABASE_URL`  
   Value: de connection string van Neon  
   Environments: Production + Preview + Development
5. **Save**

---

## Stap 4 – Opnieuw deployen

Na het zetten van `DATABASE_URL`:

1. Vercel → **Deployments**
2. Drie puntjes op de laatste deployment → **Redeploy**

Of lokaal:

```bash
git commit --allow-empty -m "trigger redeploy"
git push
```

---

## Stap 5 – Deellink maken

1. Open je Vercel-URL
2. Werk in de app (plattegrond, klussen, …)
3. Klik **🔗 Deellink** bovenaan  
   → project wordt in Neon opgeslagen  
   → link staat op je klembord
4. Stuur die link naar je vader

Iedereen met die link ziet **hetzelfde** project en kan wijzigingen opslaan.

---

## Lampje (presence)

| Weergave | Betekenis |
|----------|-----------|
| grijs + "lokaal" | nog geen deellink |
| grijs + "alleen jij" | gedeeld project, niemand anders open |
| **groen** + "1 online" | iemand anders heeft de app open op dit project |

(Heartbeat elke 15 seconden; na ~45s zonder signaal valt iemand af.)

---

## Problemen

**"DATABASE_URL ontbreekt"**  
→ Env var niet gezet of niet opnieuw gedeployed.

**Deellink faalt**  
→ Check Vercel → Logs bij de failed request; vaak ontbrekende DB of verkeerde connection string.

**Ander ziet jouw oude lokale data niet**  
→ Die moet de **deellink** openen (met `?p=…&t=…`), niet alleen de kale site-URL.
