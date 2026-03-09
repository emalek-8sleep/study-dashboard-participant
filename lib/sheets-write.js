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
 *      // tab:     sheet tab name (default: 'Participants')
 *      // dateStr: YYYY-MM-DD — when provided, row is found by Subject ID + Date
 *      //          (used for Daily Status writes). Omit for Participants writes.
 *      const { secret, subjectId, column, value, tab, dateStr } = JSON.parse(e.postData.contents);
 *      if (secret !== WRITE_SECRET) throw new Error('Unauthorized');
 *
 *      const ss        = SpreadsheetApp.getActiveSpreadsheet();
 *      const sheetName = tab || 'Participants';
 *      const sheet     = ss.getSheetByName(sheetName);
 *      if (!sheet) throw new Error('Sheet not found: ' + sheetName);
 *
 *      const lastCol = sheet.getLastColumn();
 *      const lastRow = sheet.getLastRow();
 *      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
 *                           .map(h => h.toString().trim());
 *
 *      // Find or create the target column
 *      let colIdx = headers.findIndex(h => h.toLowerCase() === column.toLowerCase());
 *      if (colIdx === -1) {
 *        colIdx = headers.length;
 *        sheet.getRange(1, colIdx + 1).setValue(column);
 *      }
 *
 *      // Find the target row
 *      const sidIdx = headers.findIndex(h => h.toLowerCase() === 'subject id');
 *      if (sidIdx === -1) throw new Error('No "Subject ID" column found');
 *
 *      let rowIdx = -1;
 *
 *      if (dateStr) {
 *        // Daily Status: match by Subject ID + Date
 *        const dateIdx = headers.findIndex(h => h.toLowerCase() === 'date');
 *        if (dateIdx === -1) throw new Error('No "Date" column found');
 *
 *        const readCols = Math.max(sidIdx, dateIdx) + 1;
 *        const allData  = sheet.getRange(1, 1, lastRow, readCols).getValues();
 *
 *        for (let i = 1; i < allData.length; i++) {
 *          const rowId = allData[i][sidIdx].toString().trim().toLowerCase();
 *          const raw   = allData[i][dateIdx];
 *          // Normalize: Sheets may return a Date object or a string
 *          let rowDate;
 *          if (raw instanceof Date) {
 *            rowDate = Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
 *          } else {
 *            rowDate = raw.toString().trim().split('T')[0];
 *          }
 *          if (rowId === subjectId.trim().toLowerCase() && rowDate === dateStr) {
 *            rowIdx = i;
 *            break;
 *          }
 *        }
 *      } else {
 *        // Participants: match by Subject ID only
 *        const allIds = sheet.getRange(1, sidIdx + 1, lastRow).getValues().flat()
 *                            .map(v => v.toString().trim().toLowerCase());
 *        rowIdx = allIds.findIndex((id, i) => i > 0 && id === subjectId.trim().toLowerCase());
 *      }
 *
 *      if (rowIdx === -1) {
 *        throw new Error(
 *          'Row not found for ' + subjectId + (dateStr ? ' on ' + dateStr : '') +
 *          ' in sheet "' + sheetName + '"'
 *        );
 *      }
 *
 *      // Force plain text so leading-zero values (e.g. PINs) aren't converted to numbers
 *      const cell = sheet.getRange(rowIdx + 1, colIdx + 1);
 *      cell.setNumberFormat('@STRING@');
 *      cell.setValue(value);
 *
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
 * Core write helper — sends a write request to the Apps Script web app.
 * @param {object} payload - { subjectId, column, value, tab?, dateStr? }
 */
async function writeToSheet(payload) {
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
    body:    JSON.stringify({ secret, ...payload }),
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

/**
 * Write `value` into `columnName` for participant `subjectId` in the
 * Participants tab. Used for PIN storage etc.
 */
export async function writeParticipantField(subjectId, columnName, value /*, sheetId unused */) {
  return writeToSheet({ subjectId, column: columnName, value });
}

/**
 * Write `value` into `columnName` for the Daily Status row matching
 * `subjectId` + `dateStr` (YYYY-MM-DD). Used for per-night data like
 * acknowledgments.
 */
export async function writeDailyStatusField(subjectId, dateStr, columnName, value) {
  return writeToSheet({ subjectId, column: columnName, value, tab: 'Daily Status', dateStr });
}
