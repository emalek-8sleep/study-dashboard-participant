/**
 * sheets.js — Google Sheets data layer
 *
 * All data is fetched from your Google Sheet using the public CSV export URL.
 * No API keys needed. Just make your sheet "Anyone with link can view"
 * and publish it to the web.
 *
 * Sheet ID lives in your .env.local file:
 *   NEXT_PUBLIC_SHEET_ID=your_google_sheet_id_here
 */

import Papa from 'papaparse';

const SHEET_ID = process.env.NEXT_PUBLIC_SHEET_ID;

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

/**
 * Fetch a single tab from the Google Sheet as an array of row objects.
 * Uses the Google Visualization query endpoint — works with published sheets.
 */
export async function fetchSheet(tabName) {
  if (!SHEET_ID) {
    console.error('NEXT_PUBLIC_SHEET_ID is not set in your .env.local file.');
    return [];
  }

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch sheet "${tabName}": ${res.status}`);
    const csv = await res.text();
    const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
    return data;
  } catch (err) {
    console.error(err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Per-tab typed helpers
// ---------------------------------------------------------------------------

/**
 * PARTICIPANTS tab
 * Expected columns (case-insensitive):
 *   Subject ID | First Name | Phase 1 Status | Phase 2 Status | ... | Notes
 *
 * Returns a single participant object or null.
 */
export async function getParticipant(subjectId) {
  const rows = await fetchSheet('Participants');
  const match = rows.find(
    (r) => normalize(r['Subject ID']) === normalize(subjectId)
  );
  return match || null;
}

/**
 * STUDY CONFIG tab
 * Expected columns:
 *   Key | Value
 *
 * Uses header:false + column index access to avoid Papa.parse header-renaming
 * issues when the sheet has extra/empty columns or names that clash.
 *
 * Returns a plain object: { study_name: '...', contact_email: '...', ... }
 */
export async function getStudyConfig() {
  if (!SHEET_ID) return {};
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('Study Config')}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
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
    console.error(err);
    return {};
  }
}

/**
 * PHASES tab
 * Expected columns:
 *   Phase Number | Phase Name | Day Number | Day Label | Description | Goal | Status Column
 *
 * Multiple rows can share the same Phase Number — each row is one day within that phase.
 * Returns array sorted by Phase Number, then Day Number.
 */
export async function getPhases() {
  const rows = await fetchSheet('Phases');
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
 * Expected columns:
 *   Title | Description | URL | Category | Icon (optional)
 *
 * Returns array grouped by Category.
 */
export async function getDocs() {
  const rows = await fetchSheet('Docs');
  return rows.filter((r) => r['Title'] && r['URL']);
}

/**
 * TROUBLESHOOTING tab
 * Expected columns:
 *   Device | Issue Title | Steps | Link (optional)
 *
 * Returns array grouped by Device.
 */
export async function getTroubleshooting() {
  const rows = await fetchSheet('Troubleshooting');
  return rows.filter((r) => r['Issue Title']);
}

/**
 * SETUP STEPS tab
 * Defines the step-by-step device setup wizard shown to participants.
 *
 * Expected columns:
 *   Step Number | Step Title | Description | Image URL | Tips
 *
 * Tips are pipe-separated, e.g. "Make sure the pod is flat | Avoid creases"
 * Returns steps sorted by Step Number.
 */
export async function getSetupSteps() {
  const rows = await fetchSheet('Setup Steps');
  return rows
    .filter((r) => r['Step Title'])
    .sort((a, b) => Number(a['Step Number'] || 0) - Number(b['Step Number'] || 0));
}

/**
 * SHIPMENTS tab
 * One row per package per participant — add/remove rows freely.
 *
 * Expected columns:
 *   Subject ID | Package Name | Tracking URL | Tracking Status
 *
 * Example rows:
 *   181 | Cover | https://ups.com/track?... | In Transit
 *   181 | Hub   | https://ups.com/track?... | Delivered
 *   181 | Nox   | https://fedex.com/...     | Out for Delivery
 *
 * Returns all shipments for the given participant, in sheet order.
 */
export async function getShipments(subjectId) {
  const rows = await fetchSheet('Shipments');
  return rows.filter((r) => normalize(r['Subject ID']) === normalize(subjectId));
}

/**
 * SHIPMENTS tab — all rows (for admin view).
 */
export async function getAllShipments() {
  return await fetchSheet('Shipments');
}

/**
 * DAILY STATUS tab
 * Expected columns:
 *   Subject ID | Date | Notes | ...dynamic columns defined in Check-in Fields tab
 *
 * Returns the most recent row for the given participant, or null.
 */
export async function getDailyStatus(subjectId) {
  const rows = await fetchSheet('Daily Status');
  const matches = rows
    .filter((r) => normalize(r['Subject ID']) === normalize(subjectId))
    .sort((a, b) => new Date(b['Date']) - new Date(a['Date']));
  return matches[0] || null;
}

/**
 * DAILY STATUS tab — full history for a participant.
 * Returns all rows sorted newest first.
 */
export async function getDailyStatusHistory(subjectId) {
  const rows = await fetchSheet('Daily Status');
  return rows
    .filter((r) => normalize(r['Subject ID']) === normalize(subjectId))
    .sort((a, b) => new Date(b['Date']) - new Date(a['Date']));
}

/**
 * CHECK-IN FIELDS tab
 * Defines which columns in Daily Status are shown on the dashboard and how.
 *
 * Expected columns:
 *   Field Label   — display name shown to participant (e.g. "Morning Survey")
 *   Column Name   — exact column header in Daily Status tab (e.g. "Survey Complete")
 *   Invalid Tips  — troubleshooting steps, pipe-separated (e.g. "Tip one | Tip two")
 *   Action Label  — button text when invalid (e.g. "Complete Survey")
 *   Action URL Key — key from Study Config whose value is the action URL (e.g. "survey_link")
 *
 * Returns array of field definitions in sheet order.
 */
export async function getCheckinFields() {
  const rows = await fetchSheet('Check-in Fields');
  return rows.filter((r) => r['Field Label'] && r['Column Name']);
}

/**
 * COMMENTS tab
 * Participants submit questions/comments via Google Form; coordinator responds in the sheet.
 *
 * Expected columns:
 *   Subject ID | Submitted At | Comment | Coordinator Response | Resolved
 *
 * Returns all rows for a specific participant, newest first.
 */
export async function getComments(subjectId) {
  const rows = await fetchSheet('Comments');
  return rows
    .filter((r) => normalize(r['Subject ID']) === normalize(subjectId))
    .sort((a, b) => new Date(b['Submitted At']) - new Date(a['Submitted At']));
}

/**
 * COMMENTS tab — all rows, newest first (for admin view).
 */
export async function getAllComments() {
  const rows = await fetchSheet('Comments');
  return rows.sort((a, b) => new Date(b['Submitted At']) - new Date(a['Submitted At']));
}

/**
 * PARTICIPANTS tab — all rows (for admin view).
 */
export async function getAllParticipants() {
  return await fetchSheet('Participants');
}

/**
 * DAILY STATUS tab — most recent row per participant (for admin view).
 * Returns a plain object keyed by normalized subject ID.
 */
export async function getAllDailyStatuses() {
  const rows = await fetchSheet('Daily Status');
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
 *
 * Phases are grouped by Phase Number. Each phase can have multiple day rows.
 * Overall phase status is derived from its days:
 *   - All complete → complete
 *   - Any in progress or some complete → inprogress
 *   - Any missed → missed (if nothing complete/in progress)
 *   - Otherwise → pending
 *
 * Possible status values in the sheet:
 *   Complete | In Progress | Pending | Missed | Withdrawn
 */
export function deriveProgress(participant, phases) {
  if (!participant || !phases.length) return [];

  // Group rows by Phase Number, preserving order
  const groupMap = new Map();
  phases.forEach((row) => {
    const num = row['Phase Number'];
    if (!groupMap.has(num)) {
      groupMap.set(num, {
        phaseNumber: num,
        phaseName: row['Phase Name'],
        description: row['Description'] || '',
        goal: row['Goal'] || '',
        days: [],
      });
    }
    const col = (row['Status Column'] || '').trim();
    const rawStatus = col ? (participant[col] || 'Pending') : 'Pending';
    groupMap.get(num).days.push({
      dayNumber: row['Day Number'] || '',
      dayLabel: row['Day Label'] || (row['Day Number'] ? `Day ${row['Day Number']}` : ''),
      statusColumn: col,
      status: normalizeStatus(rawStatus),
    });
  });

  // Compute overall phase status from its days
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

    return {
      ...group,
      status,
      completedDays,
      totalDays: group.days.length,
    };
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
