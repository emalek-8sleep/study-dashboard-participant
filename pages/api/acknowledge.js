/**
 * /api/acknowledge
 *
 * Toggles an acknowledgment on a "needs attention" check-in field.
 * Acknowledgments are stored directly on the Daily Status row for that
 * participant + date, in an "Acknowledgments" column as a pipe-separated
 * list of column names: e.g. "hrv|rhr"
 *
 * Storing on the Daily Status row (not the Participants tab) means:
 *  - It's naturally scoped per-night — no messy date suffixes accumulating
 *  - Coordinators can see exactly which fields were acknowledged on each night
 *
 * POST /api/acknowledge
 *   Body: { id, study, fieldName, dateStr, action: 'add' | 'remove' }
 *   → { success: true, acknowledgments: string[] }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, study, fieldName, dateStr, action, column } = req.body || {};

  console.log('[acknowledge] Request received:', {
    id,
    study,
    fieldName,
    dateStr,
    action,
    column,
    bodyKeys: Object.keys(req.body || {}),
  });

  // `column` lets callers target a different Daily Status column (e.g. "Tonight Checklist").
  // Defaults to "Acknowledgments" for backward compatibility with DailyStatusCard.
  const targetColumn = column || 'Acknowledgments';

  if (!id || !fieldName || !dateStr) {
    console.error('[acknowledge] Missing required fields:', {
      id: !!id,
      fieldName: !!fieldName,
      dateStr: !!dateStr,
    });
    return res.status(400).json({ success: false, error: 'Missing required fields: id, fieldName, dateStr.' });
  }

  const { getDailyStatusHistory } = await import('../../lib/sheets');
  const { getSheetIdBySlug }      = await import('../../lib/studies');
  const { writeDailyStatusField } = await import('../../lib/sheets-write');

  const sheetId = getSheetIdBySlug(study || '');
  console.log('[acknowledge] Sheet ID resolved:', { study, sheetId });

  // Find the Daily Status row for this participant + date
  const history = await getDailyStatusHistory(id, sheetId);
  console.log('[acknowledge] History fetched:', {
    subjectId: id,
    historyLength: history.length,
    firstRowDate: history[0]?.['Date'],
    firstRowKeys: history[0] ? Object.keys(history[0]).slice(0, 5) : [],
  });

  const row = history.find(
    r => (r['Date'] || '').toString().trim().split('T')[0] === dateStr
  );

  console.log('[acknowledge] Row search result:', {
    dateStr,
    found: !!row,
    rowDates: history.slice(0, 3).map(r => (r['Date'] || '').toString().trim().split('T')[0]),
  });

  if (!row) {
    console.error('[acknowledge] No row found:', {
      subjectId: id,
      dateStr,
      availableDates: history.slice(0, 5).map(r => (r['Date'] || '').toString()),
    });
    return res.status(404).json({ success: false, error: `No Daily Status row found for ${id} on ${dateStr}.` });
  }

  // Current acknowledgments: pipe-separated values stored in targetColumn on that row
  const raw      = (row[targetColumn] || '').toString().trim();
  const existing = raw ? raw.split('|').map(s => s.trim()).filter(Boolean) : [];

  console.log('[acknowledge] Current acknowledgments:', {
    targetColumn,
    raw,
    existing,
    fieldName,
    action,
  });

  let updated;
  if (action === 'remove') {
    updated = existing.filter(k => k !== fieldName);
  } else {
    // 'add' (default) — deduplicate
    updated = existing.includes(fieldName) ? existing : [...existing, fieldName];
  }

  console.log('[acknowledge] Updated acknowledgments:', {
    before: existing,
    after: updated,
    action,
  });

  try {
    await writeDailyStatusField(id, dateStr, targetColumn, updated.join('|'));
    console.log('[acknowledge] Write successful:', {
      subjectId: id,
      dateStr,
      targetColumn,
      value: updated.join('|'),
    });
    return res.status(200).json({ success: true, acknowledgments: updated });
  } catch (err) {
    console.error('[acknowledge] write error:', {
      message: err.message,
      stack: err.stack,
      subjectId: id,
      dateStr,
      targetColumn,
    });
    return res.status(500).json({
      success: false,
      error: 'Could not save acknowledgment. Check SHEET_WRITE_URL and SHEET_WRITE_SECRET env vars.',
    });
  }
}
