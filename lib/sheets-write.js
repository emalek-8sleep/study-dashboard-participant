/**
 * sheets-write.js — Google Sheets write layer via Apps Script web app
 *
 * Much simpler than a service account — no GCP project or credentials needed.
 *
 * ── One-time setup ────────────────────────────────────────────────────────────
 *  1. Open your Google Sheet → Extensions → Apps Script
 *  2. Paste the script below into the editor and save
 *  3. Click Deploy → New deployment → Web app
 *       Execute as: Me
 *       Who has access: Anyone
 *  4. Copy the deployment URL
 *  5. Add two env vars in Vercel:
 *       SHEET_WRITE_URL    = <the deployment URL>
 *       SHEET_WRITE_SECRET = <any random string you choose, e.g. a UUID>
 *  6. Paste the same random string into the Apps Script as WRITE_SECRET (see below)
 *  7. Re-deploy the script after editing (Deploy → Manage deployments → edit)
 *
 * ── Apps Script to paste ──────────────────────────────────────────────────────
 *
 *  const WRITE_SECRET = 'paste-your-secret-here';  // must match SHEET_WRITE_SECRET
 *
 *  function doPost(e) {
 *    try {
 *      const { secret, subjectId, column, value } = JSON.parse(e.postData.contents);
 *      if (secret !== WRITE_SECRET) throw new Error('Unauthorized');
 *
 *      const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Participants');
 *      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
 *                           .map(h => h.toString().trim());
 *
 *      // Find or create the target column
 *      let colIdx = headers.findIndex(h => h.toLowerCase() === column.toLowerCase());
 *      if (colIdx === -1) {
 *        colIdx = headers.length;
 *        sheet.getRange(1, colIdx + 1).setValue(column);
 *      }
 *
 *      // Find the participant row by Subject ID
 *      const sidIdx = headers.findIndex(h => h.toLowerCase() === 'subject id');
 *      if (sidIdx === -1) throw new Error('No "Subject ID" column found');
 *      const allIds = sheet.getRange(1, sidIdx + 1, sheet.getLastRow()).getValues().flat()
 *                          .map(v => v.toString().trim().toLowerCase());
 *      const rowIdx = allIds.findIndex(id => id === subjectId.trim().toLowerCase());
 *      if (rowIdx === -1) throw new Error('Participant not found: ' + subjectId);
 *
 *      // Force plain text so leading-zero PINs (e.g. 0000) aren't converted to numbers
      const cell = sheet.getRange(rowIdx + 1, colIdx + 1);
      cell.setNumberFormat('@STRING@');
      cell.setValue(value);
 *      return ContentService.createTextOutput(JSON.stringify({ success: true }))
 *                           .setMimeType(ContentService.MimeType.JSON);
 *    } catch (err) {
 *      return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
 *                           .setMimeType(ContentService.MimeType.JSON);
 *    }
 *  }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Write `value` into `columnName` for participant `subjectId`.
 * Calls the Apps Script web app — no googleapis package needed.
 */
export async function writeParticipantField(subjectId, columnName, value /*, sheetId unused */) {
  const url    = process.env.SHEET_WRITE_URL;
  const secret = process.env.SHEET_WRITE_SECRET;

  if (!url || !secret) {
    throw new Error(
      'SHEET_WRITE_URL and SHEET_WRITE_SECRET env vars are required. ' +
      'See lib/sheets-write.js for setup instructions.'
    );
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ secret, subjectId, column: columnName, value }),
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Apps Script returned HTTP ${res.status}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    throw new Error(data.error || 'Apps Script write failed');
  }
}
