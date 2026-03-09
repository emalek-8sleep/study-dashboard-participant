/**
 * sheets-write.js — Google Sheets API write layer
 *
 * Used for writing back to the Google Sheet (e.g. storing participant PINs).
 * Requires a Google Service Account with Editor access to the sheet.
 *
 * Setup:
 *  1. Go to console.cloud.google.com → APIs & Services → Credentials
 *  2. Create a Service Account, download the JSON key
 *  3. Base64-encode the JSON:  base64 -i service-account.json | tr -d '\n'
 *  4. Add GOOGLE_SERVICE_ACCOUNT_JSON=<base64 string> to your Vercel env vars
 *  5. Share your Google Sheet with the service account email (Editor access)
 *
 * The service account email looks like:
 *   something@project-name.iam.gserviceaccount.com
 */

import { google } from 'googleapis';

// ─── Auth ────────────────────────────────────────────────────────────────────

function getCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set.');

  // Support both raw JSON and base64-encoded JSON
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  }
  return json;
}

async function getAuth() {
  const credentials = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

// ─── Column helper ────────────────────────────────────────────────────────────

function colLetter(n) {
  // Convert 1-based column number → letter(s): 1=A, 2=B, 27=AA, etc.
  let result = '';
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function normalize(str) {
  return (str || '').toString().trim().toLowerCase();
}

// ─── Write a single participant column value ──────────────────────────────────

/**
 * Write `value` into `columnName` for participant `subjectId` in the
 * Participants tab of the given sheet.
 *
 * If the column doesn't exist, it is created automatically.
 */
export async function writeParticipantField(subjectId, columnName, value, sheetId) {
  const id = sheetId || process.env.NEXT_PUBLIC_SHEET_ID || '';
  if (!id) throw new Error('No Sheet ID configured.');

  const auth   = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // ── 1. Read current header row ─────────────────────────────────────────────
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: 'Participants!1:1',
  });
  const headers = (headerRes.data.values?.[0] || []).map(h => (h || '').trim());

  // ── 2. Locate or create the target column ──────────────────────────────────
  let colIdx = headers.findIndex(h => h.toLowerCase() === columnName.toLowerCase());

  if (colIdx === -1) {
    // Column doesn't exist — append it as a new header
    colIdx = headers.length;
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `Participants!${colLetter(colIdx + 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[columnName]] },
    });
  }

  // ── 3. Locate the Subject ID column ───────────────────────────────────────
  const subjectIdColIdx = headers.findIndex(
    h => h.toLowerCase() === 'subject id' || h.toLowerCase() === 'subject_id'
  );
  if (subjectIdColIdx === -1) throw new Error('No "Subject ID" column found in Participants tab.');

  // ── 4. Read all Subject IDs to find participant's row ─────────────────────
  const subjectColLetter = colLetter(subjectIdColIdx + 1);
  const allRowsRes = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `Participants!${subjectColLetter}:${subjectColLetter}`,
  });
  const allIds = (allRowsRes.data.values || []).flat().map(v => (v || '').toString().trim());

  // allIds[0] = header row ("Subject ID"), allIds[1] = first participant, etc.
  const rowIdx = allIds.findIndex(sid => normalize(sid) === normalize(subjectId));
  if (rowIdx === -1) throw new Error(`Participant "${subjectId}" not found in Participants tab.`);

  // ── 5. Write the value ────────────────────────────────────────────────────
  const cellRef = `Participants!${colLetter(colIdx + 1)}${rowIdx + 1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: cellRef,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}
