const WRITE_SECRET = 'study-dashboard-pin-login';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // ─────────────────────────────────────────────────────────────────
    // COMMENTS - no authentication required
    // ─────────────────────────────────────────────────────────────────
    if (!data.secret && action !== 'read' && action !== 'add_login' && action !== 'update_last_login') {
      // This is a comment request (no secret field present)
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName('Comments');
      if (!sheet) {
        sheet = ss.insertSheet('Comments');
        sheet.appendRow(['Subject ID','Submitted At','Comment','Coordinator Response','Resolved']);
      }
      sheet.appendRow([data.subjectId, new Date().toLocaleString(), data.comment, '', 'No']);
      return ContentService.createTextOutput(JSON.stringify({success:true}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ─────────────────────────────────────────────────────────────────
    // LOGIN LOGGING - no authentication required
    // ─────────────────────────────────────────────────────────────────
    if (action === 'add_login') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName('Login Activity');
      if (!sheet) {
        sheet = ss.insertSheet('Login Activity');
        sheet.appendRow(['Subject ID', 'Timestamp', 'Readable Time', 'User Agent']);
      }
      sheet.appendRow([
        data.subjectId || '',
        data.timestamp || '',
        data.readableTime || '',
        data.userAgent || ''
      ]);
      return ContentService.createTextOutput(JSON.stringify({success:true}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'update_last_login') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName('Participants');
      if (!sheet) {
        throw new Error('Participants sheet not found');
      }

      const lastCol = sheet.getLastColumn();
      const lastRow = sheet.getLastRow();
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                           .map(h => h.toString().trim());

      // Find Last Login column
      const lastLoginIdx = headers.findIndex(h => h.toLowerCase() === 'last login');
      if (lastLoginIdx === -1) {
        throw new Error('Last Login column not found in Participants sheet');
      }

      // Find Subject ID column
      const sidIdx = headers.findIndex(h => h.toLowerCase() === 'subject id');
      if (sidIdx === -1) {
        throw new Error('No "Subject ID" column found');
      }

      // Find the row with matching Subject ID
      const allIds = sheet.getRange(1, sidIdx + 1, lastRow).getValues().flat()
                          .map(v => v.toString().trim().toLowerCase());
      const rowIdx = allIds.findIndex((id, i) => i > 0 && id === data.subjectId.trim().toLowerCase());

      if (rowIdx === -1) {
        throw new Error('Subject ID not found: ' + data.subjectId);
      }

      // Update Last Login cell
      sheet.getRange(rowIdx + 1, lastLoginIdx + 1).setValue(data.lastLogin || '');
      return ContentService.createTextOutput(JSON.stringify({success:true}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ─────────────────────────────────────────────────────────────────
    // APPEND ROW - no authentication required
    // Used for Analysis Plans and Analysis History tabs
    // ─────────────────────────────────────────────────────────────────
    if (action === 'append_row') {
      const ALLOWED_TABS = ['Analysis Plans', 'Analysis History'];
      if (!ALLOWED_TABS.includes(data.tab)) {
        throw new Error('Tab not allowed for append_row: ' + data.tab);
      }

      const HEADERS = {
        'Analysis Plans': [
          'ID', 'Created At', 'Study', 'Title', 'IV', 'DV', 'Design',
          'Conditions', 'Primary Outcome', 'Secondary Outcomes',
          'Statistical Tests', 'Assumption Tests', 'Notes', 'Status', 'Source', 'Full Text'
        ],
        'Analysis History': [
          'ID', 'Plan ID', 'Created At', 'Study', 'Plan Title',
          'Code Used', 'Results JSON', 'Interpretation', 'Report HTML', 'Status'
        ],
      };

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName(data.tab);
      if (!sheet) {
        sheet = ss.insertSheet(data.tab);
        sheet.appendRow(HEADERS[data.tab]);
        // Freeze header row
        sheet.setFrozenRows(1);
      }
      sheet.appendRow(data.row);
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ─────────────────────────────────────────────────────────────────
    // READ/WRITE OPERATIONS - requires WRITE_SECRET
    // ─────────────────────────────────────────────────────────────────
    if (!data.secret || data.secret !== WRITE_SECRET) {
      throw new Error('Unauthorized');
    }

    const { subjectId, column, value, tab, dateStr } = data;
    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = tab || 'Participants';
    const sheet     = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('Sheet not found: ' + sheetName);

    const lastCol = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                         .map(h => h.toString().trim());

    // ── action: 'read' — read a cell value ──────────────────────────
    if (action === 'read') {
      const colIdx = headers.findIndex(h => h.toLowerCase() === column.toLowerCase());
      if (colIdx === -1) {
        return ContentService.createTextOutput(JSON.stringify({ success: true, value: '' }))
                             .setMimeType(ContentService.MimeType.JSON);
      }
      const sidIdx = headers.findIndex(h => h.toLowerCase() === 'subject id');
      if (sidIdx === -1) throw new Error('No "Subject ID" column found');
      const allIds = sheet.getRange(1, sidIdx + 1, lastRow).getValues().flat()
                          .map(v => v.toString().trim().toLowerCase());
      const rowIdx = allIds.findIndex((id, i) => i > 0 && id === subjectId.trim().toLowerCase());
      if (rowIdx === -1) {
        return ContentService.createTextOutput(JSON.stringify({ success: true, value: '' }))
                             .setMimeType(ContentService.MimeType.JSON);
      }
      const cellValue = sheet.getRange(rowIdx + 1, colIdx + 1).getValue();
      return ContentService.createTextOutput(JSON.stringify({ success: true, value: cellValue.toString() }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    // ── default: write a cell value ────────────────────────────────
    // Find or create the target column
    let colIdx = headers.findIndex(h => h.toLowerCase() === column.toLowerCase());
    if (colIdx === -1) {
      colIdx = headers.length;
      sheet.getRange(1, colIdx + 1).setValue(column);
    }

    // Find the target row
    const sidIdx = headers.findIndex(h => h.toLowerCase() === 'subject id');
    if (sidIdx === -1) throw new Error('No "Subject ID" column found');
    let rowIdx = -1;

    if (dateStr) {
      // Daily Status: match by Subject ID + Date
      const dateIdx = headers.findIndex(h => h.toLowerCase() === 'date');
      if (dateIdx === -1) throw new Error('No "Date" column found');
      const readCols = Math.max(sidIdx, dateIdx) + 1;
      const allData  = sheet.getRange(1, 1, lastRow, readCols).getValues();
      for (let i = 1; i < allData.length; i++) {
        const rowId = allData[i][sidIdx].toString().trim().toLowerCase();
        const raw   = allData[i][dateIdx];
        // Normalize: Sheets may return a Date object or a string
        let rowDate;
        if (raw instanceof Date) {
          rowDate = Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } else {
          rowDate = raw.toString().trim().split('T')[0];
        }
        if (rowId === subjectId.trim().toLowerCase() && rowDate === dateStr) {
          rowIdx = i;
          break;
        }
      }
    } else {
      // Participants: match by Subject ID only
      const allIds = sheet.getRange(1, sidIdx + 1, lastRow).getValues().flat()
                          .map(v => v.toString().trim().toLowerCase());
      rowIdx = allIds.findIndex((id, i) => i > 0 && id === subjectId.trim().toLowerCase());
    }

    if (rowIdx === -1) {
      throw new Error(
        'Row not found for ' + subjectId + (dateStr ? ' on ' + dateStr : '') +
        ' in sheet "' + sheetName + '"'
      );
    }

    // Force plain text so leading-zero values (e.g. PINs) aren't converted to numbers
    const cell = sheet.getRange(rowIdx + 1, colIdx + 1);
    cell.setNumberFormat('@STRING@');
    cell.setValue(value);

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
                         .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({success:false, error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
