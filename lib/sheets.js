/**
 * sheets.js — Google Sheets data layer
 *
 * All data is fetched from your Google Sheet using the public CSV export URL.
 * No API keys needed. Just make your sheet "Anyone with link can view"
 * and publish it to the web.
 *
 * Multi-study: every function accepts an optional `sheetId` parameter.
 * When omitted, it falls back to the default study's sheet (from lib/studies.js).
 */

import Papa from 'papaparse';

// ---------------------------------------------------------------------------
// Fetch helper with timeout
// ---------------------------------------------------------------------------

/**
 * fetch() wrapper that aborts after `timeoutMs` milliseconds (default 8s).
 * Prevents serverless functions from hanging when Google Sheets is slow/unreachable.
 */
async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

/**
 * Fetch a single tab from the Google Sheet as an array of row objects.
 * Uses the Google Visualization query endpoint — works with published sheets.
 */
export async function fetchSheet(tabName, sheetId) {
  const id = sheetId || process.env.NEXT_PUBLIC_SHEET_ID || '';
  if (!id) {
    console.error('No Sheet ID configured. Set STUDIES or NEXT_PUBLIC_SHEET_ID in your env.');
    return [];
  }

  // Use gviz/tq with a unique reqId per request to defeat Google's CDN cache.
  // reqId is a recognised tqx parameter (unlike random _t params which may be
  // stripped before cache-key calculation). This ensures each call reads fresh
  // data — critical for PIN reads immediately after a write.
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv;reqId:${Date.now()}&sheet=${encodeURIComponent(tabName)}`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Failed to fetch sheet "${tabName}": ${res.status}`);
    const csv = await res.text();
    const { data, meta } = Papa.parse(csv, { header: true, skipEmptyLines: true });
    // Normalize headers in-place: trim whitespace so columns like " PIN" match 'PIN'
    if (meta?.fields) {
      const remap = Object.fromEntries(meta.fields.map(f => [f, f.trim()]));
      const anyDirty = meta.fields.some(f => f !== f.trim());
      if (anyDirty) {
        data.forEach(row => {
          meta.fields.forEach(rawKey => {
            const cleanKey = rawKey.trim();
            if (rawKey !== cleanKey && rawKey in row) {
              row[cleanKey] = row[rawKey];
              delete row[rawKey];
            }
          });
        });
      }
    }
    return data;
  } catch (err) {
    console.error(`[sheets] fetchSheet("${tabName}") error:`, err.message || err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Per-tab typed helpers
// ---------------------------------------------------------------------------

/**
 * PARTICIPANTS tab
 * Expected columns: Subject ID | First Name | Phase 1 Status | ... | Notes
 * Returns a single participant object or null.
 */
export async function getParticipant(subjectId, sheetId) {
  const rows = await fetchSheet('Participants', sheetId);
  const match = rows.find(
    (r) => normalize(r['Subject ID']) === normalize(subjectId)
  );
  return match || null;
}

/**
 * STUDY CONFIG tab
 * Expected columns: Key | Value
 *
 * Uses header:false + column index access to avoid Papa.parse header-renaming
 * issues when the sheet has extra/empty columns or names that clash.
 *
 * Returns a plain object: { study_name: '...', contact_email: '...', ... }
 */
export async function getStudyConfig(sheetId) {
  const id = sheetId || process.env.NEXT_PUBLIC_SHEET_ID || '';
  if (!id) return {};

  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv;reqId:${Date.now()}&sheet=${encodeURIComponent('Study Config')}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Failed to fetch sheet "Study Config": ${res.status}`);
    const csv = await res.text();
    // Parse without headers so duplicate/renamed column names don't break anything
    const { data } = Papa.parse(csv, { header: false, skipEmptyLines: true });
    const config = {};
    // Row 0 is the header (Key | Value) — skip it
    data.slice(1).forEach((row) => {
      const key   = (row[0] || '').trim();
      const value = (row[1] || '').trim();
      if (key && key.toLowerCase() !== 'key') {
        config[key.toLowerCase().replace(/\s+/g, '_')] = value;
      }
    });
    return config;
  } catch (err) {
    console.error(`[sheets] getStudyConfig() error:`, err.message || err);
    return {};
  }
}

/**
 * PHASES tab
 * Expected columns: Phase Number | Phase Name | Day Number | Day Label | Description | Goal | Status Column
 * Returns array sorted by Phase Number, then Day Number.
 */
export async function getPhases(sheetId) {
  const rows = await fetchSheet('Phases', sheetId);
  return rows
    .filter((r) => r['Phase Name'])
    .sort((a, b) => {
      const phaseDiff = Number(a['Phase Number']) - Number(b['Phase Number']);
      if (phaseDiff !== 0) return phaseDiff;
      return Number(a['Day Number'] || 1) - Number(b['Day Number'] || 1);
    });
}

/**
 * DOCS tab
 * Expected columns: Title | Description | URL | Category | Icon (optional)
 */
export async function getDocs(sheetId) {
  const rows = await fetchSheet('Docs', sheetId);
  return rows.filter((r) => r['Title'] && r['URL']);
}

/**
 * TROUBLESHOOTING tab
 * Expected columns: Device | Issue Title | Steps | Link (optional)
 */
export async function getTroubleshooting(sheetId) {
  const rows = await fetchSheet('Troubleshooting', sheetId);
  return rows.filter((r) => r['Issue Title']);
}

/**
 * SETUP STEPS tab
 * Expected columns: Step Number | Step Title | Description | Image URL | Tips
 * Tips are pipe-separated. Returns steps sorted by Step Number.
 */
export async function getSetupSteps(sheetId) {
  const rows = await fetchSheet('Setup Steps', sheetId);
  return rows
    .filter((r) => r['Step Title'])
    .sort((a, b) => Number(a['Step Number'] || 0) - Number(b['Step Number'] || 0));
}

/**
 * SHIPMENTS tab — one row per package per participant.
 * Expected columns: Subject ID | Package Name | Tracking URL | Tracking Status
 */
export async function getShipments(subjectId, sheetId) {
  const rows = await fetchSheet('Shipments', sheetId);
  return rows.filter((r) => normalize(r['Subject ID']) === normalize(subjectId));
}

/**
 * SHIPMENTS tab — all rows (for admin view).
 */
export async function getAllShipments(sheetId) {
  return await fetchSheet('Shipments', sheetId);
}

/**
 * DAILY STATUS tab — most recent row for a participant.
 */
export async function getDailyStatus(subjectId, sheetId) {
  const rows = await fetchSheet('Daily Status', sheetId);
  const matches = rows
    .filter((r) => normalize(r['Subject ID']) === normalize(subjectId))
    .sort((a, b) => new Date(b['Date']) - new Date(a['Date']));
  return matches[0] || null;
}

/**
 * DAILY STATUS tab — full history for a participant, newest first.
 */
export async function getDailyStatusHistory(subjectId, sheetId) {
  const rows = await fetchSheet('Daily Status', sheetId);
  return rows
    .filter((r) => normalize(r['Subject ID']) === normalize(subjectId))
    .sort((a, b) => new Date(b['Date']) - new Date(a['Date']));
}

/**
 * CHECK-IN FIELDS tab
 * Defines which columns in Daily Status are shown on the dashboard and how.
 *
 * Expected columns:
 *   Field Label | Column Name | Invalid Tips | Action Label | Action URL Key
 */
export async function getCheckinFields(sheetId) {
  const rows = await fetchSheet('Check-in Fields', sheetId);
  return rows.filter((r) => r['Field Label'] && r['Column Name']);
}

/**
 * COMMENTS tab — all rows for a specific participant, newest first.
 * Expected columns: Subject ID | Submitted At | Comment | Coordinator Response | Resolved
 */
export async function getComments(subjectId, sheetId) {
  const rows = await fetchSheet('Comments', sheetId);
  return rows
    .filter((r) => normalize(r['Subject ID']) === normalize(subjectId))
    .sort((a, b) => new Date(b['Submitted At']) - new Date(a['Submitted At']));
}

/**
 * COMMENTS tab — all rows, newest first (for admin view).
 */
export async function getAllComments(sheetId) {
  const rows = await fetchSheet('Comments', sheetId);
  return rows.sort((a, b) => new Date(b['Submitted At']) - new Date(a['Submitted At']));
}

/**
 * PARTICIPANTS tab — all rows (for admin view).
 */
export async function getAllParticipants(sheetId) {
  return await fetchSheet('Participants', sheetId);
}

/**
 * DAILY STATUS tab — ALL rows, newest-first (for admin Data view).
 * Unlike getAllDailyStatuses(), this returns every row — not just the latest
 * per participant — so coordinators can see the full history and any metric
 * columns (AHI, Vibration, Condition, etc.) they've added alongside check-in data.
 */
export async function getAllDailyStatusRows(sheetId) {
  const rows = await fetchSheet('Daily Status', sheetId);
  return rows
    .filter((r) => r['Subject ID'] && r['Date'])
    .sort((a, b) => {
      const dateDiff = new Date(b['Date']) - new Date(a['Date']);
      if (dateDiff !== 0) return dateDiff;
      return (a['Subject ID'] || '').localeCompare(b['Subject ID'] || '');
    });
}

/**
 * DAILY STATUS tab — most recent row per participant (for admin view).
 * Returns a plain object keyed by normalized subject ID.
 */
export async function getAllDailyStatuses(sheetId) {
  const rows = await fetchSheet('Daily Status', sheetId);
  const latest = {};
  rows.forEach((r) => {
    const id = normalize(r['Subject ID']);
    if (!id) return;
    if (!latest[id] || new Date(r['Date']) > new Date(latest[id]['Date'])) {
      latest[id] = r;
    }
  });
  return latest;
}

/**
 * Build a URL with {{subject_id}} placeholder replaced.
 * e.g. https://forms.google.com/...?entry.123={{subject_id}}
 */
export function buildParticipantUrl(template, subjectId) {
  if (!template) return '';
  return template.replace(/\{\{subject_id\}\}/gi, encodeURIComponent(subjectId));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function normalize(str) {
  return (str || '').toString().trim().toLowerCase();
}

/**
 * Derive a participant's phase progress from their row data + the phases list.
 */
export function deriveProgress(participant, phases) {
  if (!participant || !phases.length) return [];

  const groupMap = new Map();
  phases.forEach((row) => {
    const num = row['Phase Number'];
    if (!groupMap.has(num)) {
      groupMap.set(num, {
        phaseNumber: num,
        phaseName:   row['Phase Name'],
        description: row['Description'] || '',
        goal:        row['Goal'] || '',
        days:        [],
      });
    }
    const col       = (row['Status Column'] || '').trim();
    const rawStatus = col ? (participant[col] || 'Pending') : 'Pending';
    groupMap.get(num).days.push({
      dayNumber:    row['Day Number'] || '',
      dayLabel:     row['Day Label'] || (row['Day Number'] ? `Day ${row['Day Number']}` : ''),
      statusColumn: col,
      status:       normalizeStatus(rawStatus),
    });
  });

  return Array.from(groupMap.values()).map((group) => {
    const statuses = group.days.map((d) => d.status);
    let status;
    if (statuses.every((s) => s === 'complete')) {
      status = 'complete';
    } else if (statuses.some((s) => s === 'inprogress') || statuses.some((s) => s === 'complete')) {
      status = 'inprogress';
    } else if (statuses.every((s) => s === 'missed')) {
      status = 'missed';
    } else {
      status = 'pending';
    }

    const completedDays = statuses.filter((s) => s === 'complete').length;
    return { ...group, status, completedDays, totalDays: group.days.length };
  });
}

function normalizeStatus(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('complete') || s === 'done' || s === 'yes') return 'complete';
  if (s.includes('progress') || s === 'active' || s === 'current') return 'inprogress';
  if (s.includes('miss') || s === 'no') return 'missed';
  if (s.includes('withdraw')) return 'withdrawn';
  return 'pending';
}

/**
 * METRICS tab — all rows, newest-first (for admin view).
 *
 * Required columns: Subject ID | Date
 * All other columns are study-specific metrics (AHI, vibration, SpO2 Min, etc.)
 * and are returned as-is — the schema is fully dynamic.
 *
 * tabName defaults to "Metrics" but can be overridden via the
 * Study Config key `metrics_tab_name` (pass it from getServerSideProps).
 */
export async function getAllMetrics(sheetId, tabName = 'Metrics') {
  const rows = await fetchSheet(tabName, sheetId);
  return rows
    .filter((r) => r['Subject ID'] && r['Date'])
    .sort((a, b) => {
      const dateDiff = new Date(b['Date']) - new Date(a['Date']);
      if (dateDiff !== 0) return dateDiff;
      return (a['Subject ID'] || '').localeCompare(b['Subject ID'] || '');
    });
}

/**
 * Compute per-metric aggregate stats (min/max/avg/count) from a metrics array.
 * Skips non-numeric values. Returns an object keyed by column name.
 */
export function buildMetricsSummary(metrics) {
  if (!metrics.length) return {};

  const metricCols = Object.keys(metrics[0]).filter(
    (k) => k !== 'Subject ID' && k !== 'Date'
  );

  const summary = {};
  metricCols.forEach((col) => {
    const values = metrics
      .map((m) => parseFloat(m[col]))
      .filter((v) => !isNaN(v));

    if (values.length > 0) {
      const sum = values.reduce((a, b) => a + b, 0);
      summary[col] = {
        min:   Math.min(...values),
        max:   Math.max(...values),
        avg:   +(sum / values.length).toFixed(2),
        count: values.length,
      };
    }
  });

  return summary;
}

/**
 * Group an array of objects by a given key.
 */
export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'Other';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}
