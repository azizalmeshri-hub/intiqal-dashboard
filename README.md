# Intiqal Dashboard | لوحة تحكم انتقال

Bilingual (AR/EN) project & financial dashboard for **Intiqal General Contracting Co.**,
built for CEO/CFO-level monitoring of the two active projects:

- **Sadra (by Roshn)** — Riyadh, Intiqal as subcontractor via Building Construction Co.,
  executed through Specialized Building Contracting Co. ~95% complete.
- **Ajdan (NHC)** — Intiqal as subcontractor to Al Oula Manazil, doing excavation,
  infrastructure, and full duplex construction.

## Stack
- React 18 + Vite
- react-router-dom (HashRouter — works on GitHub Pages with no server config)
- recharts for charts
- Plain CSS with design tokens (no framework) — see `src/index.css`

## Run locally
```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build to /dist
npm run preview   # preview the production build
```

## Deploy to GitHub Pages
1. Push this repo to GitHub (see "Connect to your repo" below).
2. In the repo: **Settings → Pages → Source = GitHub Actions**.
3. Push to `main` — `.github/workflows/deploy.yml` builds and deploys automatically.

## Connect to your repo (first time)
```bash
git init            # if not already a repo
git add -A
git commit -m "Initial dashboard: bilingual AR/EN, Sadra + Ajdan projects"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## ⚠️ Data status — please verify before using for real decisions
This is v1, seeded from the statements you provided. Flagged items:

| Item | Status |
|---|---|
| Sadra contract value | **Placeholder** — not yet confirmed, used only to scale UI |
| Ajdan contract value (59,793,270 SAR) | Confirmed by you |
| Ajdan % complete | Derived as (completed incl. advance) ÷ (contract value) — can exceed 100%, needs finance sign-off |
| Overhead / indirect costs | Not yet included — pending your figures |
| Supplier/contractor balances | Pulled from the individual statements in `/mnt/project` — worth a line-by-line audit |

Edit `src/data/projects.js` directly to correct any figure — it's one plain JS file,
no database required for v1.

## Roadmap (phase 2)
- [ ] Automatic parsing of uploaded PDFs/bank statements (OCR + line-item extraction)
- [ ] Overhead & indirect cost allocation across projects
- [ ] Persistent storage (currently in-memory only — refresh clears manual entries/uploads)
- [ ] Role-based views (CEO vs CFO vs PM)
- [ ] Export to Excel/PDF for board reporting

## Project structure
```
src/
  components/   # StatCard, TapeProgress, StatusBadge, Sidebar
  context/      # LangContext — AR/EN + RTL/LTR switching
  data/         # projects.js — all financial data lives here for now
  i18n/         # dictionary.js — every UI string, AR + EN
  pages/        # Overview, Sadra, Ajdan, Ledger, Upload
```
