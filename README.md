# VoltSmart — Smart IoT Energy Tracker

A dark-themed React + Vite dashboard for tracking home appliance energy usage,
estimating electricity cost on real MSEDCL (Mahavitaran) residential slab
rates, and running "what-if" savings simulations.

## Tech stack

- React 18 + Vite
- Tailwind CSS
- Recharts (charts)
- lucide-react (icons)
- Browser `localStorage` for persistence (devices, profile, settings)

## Run locally

```bash
npm install
npm run dev
```

Then open the printed local URL (usually `http://localhost:5173`).

## Build for production

```bash
npm run build
npm run preview   # optional: preview the production build locally
```

The build output goes to `dist/`.

## Deploy to Vercel

**Option A — Vercel CLI**

```bash
npm install -g vercel
vercel
```

Follow the prompts (framework preset: Vite — Vercel auto-detects this from
`package.json`). Vercel will run `npm run build` and serve `dist/`
automatically.

**Option B — Vercel dashboard**

1. Push this folder to a GitHub/GitLab/Bitbucket repo.
2. Go to vercel.com → **Add New Project** → import the repo.
3. Framework preset: **Vite** (auto-detected). Leave build command
   (`npm run build`) and output directory (`dist`) as default.
4. Click **Deploy**.

**Option C — Drag and drop (no git needed)**

```bash
npm install
npm run build
```

Then go to https://vercel.com/new and drag the generated `dist/` folder in,
or use https://app.netlify.com/drop for Netlify instead.

## Notes

- All energy/cost math lives in one place at the top of `src/App.jsx`
  (`calculateMSEDCLCost`, `calculateDeviceMonthlyEnergy`, etc.) — edit the
  `MSEDCL_TARIFF` object there if slab rates change.
- Data (devices, profile, settings) is stored in the browser's
  `localStorage` under the key `voltsmart:state`, so it persists across
  refreshes on the same device/browser but does not sync across devices —
  wiring up a real backend would replace the `loadState`/`saveState`
  functions near the top of `src/App.jsx`.
