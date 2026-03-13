# Dashboard Improvements — Implementation Plan

## Current Architecture

The dashboard is a Next.js (Pages Router) app deployed on Vercel, backed by a Google Sheet for all persistent data. An Apps Script handles writes (comments, login logging, analysis plan/run saves). Claude API calls use Haiku for code generation and Sonnet for interpretation. Python analysis runs client-side via Pyodide (WebAssembly).

**Environment variables:** `NEXT_PUBLIC_SHEET_ID`, `SHEET_WRITE_URL`, `SHEET_WRITE_SECRET`, `ADMIN_CODE`, `ANTHROPIC_API_KEY`, `STUDIES`

---

## 1. Vercel KV (Redis) — Sheet Caching Layer

### What it does
Caches Google Sheet reads in a Redis store with a configurable TTL (e.g., 5 minutes). Every `fetchSheet()` and `getStudyConfig()` call checks KV first, falls back to Google, then writes the result to KV.

### Implementation
- Install `@vercel/kv`
- Wrap `fetchSheet()` in `lib/sheets.js` with a cache-through pattern:
  ```
  fetchSheet(tabName, sheetId) →
    1. Check KV: key = `sheet:${sheetId}:${tabName}`
    2. If hit and < TTL, return cached
    3. If miss, fetch from Google, write to KV, return
  ```
- Add a `?refresh=true` query param to admin pages to bust cache on demand
- Add `/api/cache-invalidate` endpoint (admin-only) for manual purge

### Files changed
- `lib/sheets.js` — add KV wrapper around `fetchWithTimeout`
- `package.json` — add `@vercel/kv`
- New: `/api/cache-invalidate.js`

### Pros
- Dashboard loads 5-10x faster (KV reads are <5ms vs 2-8s for Sheets)
- Reduces Google API quota usage
- Protects against Sheets outages (serves stale data gracefully)
- Eliminates the `getStudyConfig() error: This operation was aborted` timeouts

### Cons
- Adds Vercel KV billing (~$3/mo for Hobby, included in Pro)
- Data staleness: coordinators editing the sheet won't see changes for up to 5 min
- One more env var to configure (`KV_REST_API_URL`, `KV_REST_API_TOKEN` — auto-set by Vercel when you provision KV)

### Vercel duplication impact
When you duplicate the project, KV is NOT duplicated — you'd need to provision a new KV store for the duplicate and it auto-sets the env vars. No code changes needed since the KV client reads env vars automatically.

### Security
- KV is scoped to your Vercel project — no public access
- No secrets stored in KV (just sheet data that's already published)
- Cache invalidation endpoint should be admin-gated (check `ADMIN_CODE`)

### Speed impact
- Cold page loads: ~200ms (vs current 3-8s)
- Warm page loads: ~100ms
- Sheet updates visible after TTL expiry (configurable)

---

## 2. Vercel Blob — Report & Figure Storage

### What it does
Stores generated HTML reports, analysis figures (SVG/PNG), and large code outputs in Vercel Blob instead of Google Sheet cells. Sheet cells have a ~50K character limit and make the sheet slow when full of large blobs.

### Implementation
- Install `@vercel/blob`
- After analysis runs, upload report HTML + any figures to Blob
- Store the Blob URL in the Analysis History sheet (instead of raw HTML)
- Viewer component fetches from Blob URL to render reports
- Existing runs with inline HTML continue to work (backward compatible)

### Files changed
- `pages/api/analysis/save-run.js` — upload to Blob, store URL
- `pages/admin.js` — detect URL vs inline HTML in report field
- `package.json` — add `@vercel/blob`
- New: `/api/analysis/report/[id].js` — proxy for report viewing

### Pros
- No more sheet cell size limits (reports can be any size)
- Sheet stays fast and lightweight
- Reports get permanent URLs (shareable outside the dashboard)
- Enables future figure embedding (matplotlib PNGs, plotly HTML)

### Cons
- Adds Vercel Blob billing (~$0.02/GB stored, $0.05/GB transferred — very cheap)
- Reports now depend on Vercel being up (vs embedded in sheet)
- One more service to provision when duplicating

### Vercel duplication impact
Blob storage is per-project — duplicating creates a new empty Blob store. Historical report URLs from the original project won't resolve in the duplicate. You'd need to re-run analyses to regenerate reports in the new store.

### Security
- Blob URLs are signed and scoped to your project
- Can configure public or private access per blob
- No auth secrets stored in Blob

### Speed impact
- Save-run becomes slightly slower (+200ms for upload)
- Report viewing becomes faster (Blob serves from CDN vs parsing sheet cell)

---

## 3. Server-Side Python Execution (Replacing Pyodide)

### What it does
Moves Python analysis execution from the browser (Pyodide/WASM) to a Vercel serverless function. Uses a real Python runtime with full scipy/statsmodels/matplotlib support.

### Implementation
- Create a Python API route using Vercel's Python runtime (`@vercel/python`)
- Route receives: analysis code, CSV data, column mappings
- Executes in a sandboxed subprocess with timeout
- Returns: JSON results + base64-encoded figures
- Keep Pyodide as a fallback option (user can toggle in settings)

### Files changed
- New: `/api/analysis/execute.py` — Python serverless function
- New: `requirements.txt` — numpy, pandas, scipy, statsmodels, matplotlib
- `pages/admin.js` — replace Pyodide runner with API call
- `vercel.json` — configure Python runtime and function timeout

### Pros
- No 40-second Pyodide load time in browser
- Full matplotlib/seaborn for publication-quality figures
- Access to more Python packages (sklearn, pingouin, etc.)
- Consistent execution environment (no browser-specific WASM issues)
- Can handle larger datasets (Pyodide has memory limits)

### Cons
- Vercel Hobby: 10s function timeout (may not be enough for complex analyses)
- Vercel Pro: 60s timeout (sufficient for most analyses)
- Cold starts add 2-5s on first execution
- Data must be sent over the network (vs Pyodide running locally)
- Requires Vercel Pro for analyses that take >10s

### Vercel duplication impact
No impact — Python runtime is configured in `vercel.json` and `requirements.txt`, both of which are in the repo. Duplicated project gets the same Python environment automatically.

### Security
- Code execution is sandboxed in Vercel's serverless environment
- Each invocation gets a fresh container (no state leakage)
- Should validate/sanitize the code string before execution
- Add a code allowlist for imports (prevent `os`, `subprocess`, `socket`, etc.)
- Rate-limit the endpoint to prevent abuse

### Speed impact
- First run: 5-8s (cold start + execution) vs current 40-50s (Pyodide load + execution)
- Subsequent runs: 1-3s (warm container) vs current 3-10s (Pyodide cached)
- Net improvement: 3-10x faster

---

## 4. Vercel Cron — Automated Anomaly Detection & Weekly Summaries

### What it does
Scheduled serverless functions that run automatically:
- **Daily anomaly scan** — checks rolling metrics for each participant, flags statistical outliers or missing data patterns, writes alerts to an "Alerts" sheet tab
- **Weekly study summary** — generates a plain-English study update (enrollment, compliance, metric trends) using Claude Sonnet, writes to a "Weekly Reports" tab

### Implementation
- Create cron-triggered API routes
- Anomaly detector: fetch latest Daily Status rows, compute rolling z-scores per participant, flag deviations >2.5σ from their own baseline
- Weekly summary: aggregate all participant data, send to Claude Sonnet with a structured prompt, store the narrative
- Both write results to new sheet tabs via existing Apps Script `append_row`

### Files changed
- New: `/api/cron/anomaly-scan.js`
- New: `/api/cron/weekly-summary.js`
- `vercel.json` — add cron schedule config
- Apps Script — add `Alerts` and `Weekly Reports` to `ALLOWED_TABS`

### `vercel.json` cron config
```json
{
  "crons": [
    { "path": "/api/cron/anomaly-scan", "schedule": "0 6 * * *" },
    { "path": "/api/cron/weekly-summary", "schedule": "0 9 * * 1" }
  ]
}
```

### Pros
- Passive monitoring without coordinator effort
- Early detection of device issues, non-compliance, or data anomalies
- Weekly summaries save 30-60 min of manual analysis per week
- Audit trail of all alerts and summaries in the sheet

### Cons
- Vercel Hobby: limited to 1 cron job (would need to combine into one)
- Vercel Pro: unlimited crons
- Each cron invocation counts toward function execution quota
- Claude API costs for weekly summaries (~$0.02-0.05 per summary)
- False positive alerts could create noise

### Vercel duplication impact
Cron config lives in `vercel.json` — duplicated project gets the same schedules. Both projects would run their own crons independently (which is correct since they'd be separate studies). No conflicts.

### Security
- Cron endpoints should verify the request comes from Vercel (check `Authorization` header with `CRON_SECRET`)
- Anomaly alerts contain participant IDs — same sensitivity level as existing sheet data
- Claude API calls send aggregated stats, not raw participant data

### Speed impact
- No impact on dashboard load times (runs async)
- Anomaly scan: ~5-10s execution per study
- Weekly summary: ~15-30s (Claude Sonnet call)

---

## 5. Edge Config — Static Configuration Cache

### What it does
Stores rarely-changing configuration (study metadata, feature flags, sheet IDs) in Vercel Edge Config for near-zero latency reads. Unlike KV (which is Redis), Edge Config is replicated to every edge node.

### Implementation
- Move Study Config values to Edge Config at deploy time (or via admin action)
- `getStudyConfig()` reads from Edge Config first, falls back to sheet
- Add an admin button to "sync config" that pushes sheet values to Edge Config

### Files changed
- `lib/sheets.js` — add Edge Config read in `getStudyConfig()`
- New: `/api/admin/sync-config.js` — pushes sheet config to Edge Config
- `package.json` — add `@vercel/edge-config`

### Pros
- Config reads are <1ms (vs 2-8s from Sheets)
- Eliminates the most common timeout source
- Works even when Google Sheets is down

### Cons
- One more thing to keep in sync (sheet changes need manual or automated sync)
- Edge Config has a 512KB limit (more than enough for config, not for data)
- Adds complexity to the config update flow
- Vercel Hobby: 1 Edge Config store (sufficient)

### Vercel duplication impact
Edge Config is per-project — duplicated project needs its own store provisioned. Initial sync must be run manually after duplication.

### Security
- Edge Config is read-only from edge functions (writes require API token)
- No secrets should be stored in Edge Config (use env vars for secrets)
- Sync endpoint should be admin-gated

### Speed impact
- `getStudyConfig()`: <1ms (vs current 2-8s)
- Every page load benefits (config is fetched on every request)

---

## Implementation Priority

| Priority | Feature | Effort | Impact | Vercel Plan |
|----------|---------|--------|--------|-------------|
| 1 | Vercel KV (caching) | 2-3 hours | High — fixes timeouts, 10x faster loads | Hobby OK |
| 2 | Server-side Python | 3-4 hours | High — fixes Pyodide UX, enables figures | Pro recommended |
| 3 | Vercel Blob (reports) | 2-3 hours | Medium — enables figures, fixes sheet bloat | Hobby OK |
| 4 | Cron jobs (alerts) | 3-4 hours | Medium — passive monitoring, time savings | Pro recommended |
| 5 | Edge Config | 1-2 hours | Low-Medium — nice-to-have if KV is in place | Hobby OK |

### Recommended order
Start with **KV caching** (biggest reliability win), then **server-side Python** (biggest UX win), then **Blob** (unblocks figures in reports), then **crons** (passive value), then **Edge Config** (polish).

### Total estimated cost impact
- Hobby plan: +$3-5/month (KV + Blob)
- Pro plan: +$3-5/month on top of Pro pricing (KV + Blob + Crons included)
- Claude API: +$1-5/month (cron summaries + anomaly alerts)

---

## Duplication Checklist

When duplicating the Vercel project for a new study:

1. **Automatic** (comes with repo): vercel.json crons, requirements.txt, all code
2. **Provision manually**: KV store, Blob store, Edge Config store (Vercel dashboard)
3. **Set env vars**: `NEXT_PUBLIC_SHEET_ID`, `SHEET_WRITE_URL`, `SHEET_WRITE_SECRET`, `ADMIN_CODE`, `ANTHROPIC_API_KEY`, `STUDIES` (KV/Blob/Edge Config env vars auto-set when provisioned)
4. **Run once**: `/api/admin/sync-config` to populate Edge Config from new sheet
5. **Apps Script**: Deploy a new standalone script with the correct `SPREADSHEET_ID`
6. **Sheet tabs**: Ensure `Analysis Plans`, `Analysis History`, `Alerts`, `Weekly Reports` tabs exist (or let the Apps Script auto-create them on first write)
