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

  const { id, study, fieldName, dateStr, action } = req.body || {};

  if (!id || !fieldName || !dateStr) {
    return res.status(400).json({ success: false, error: 'Missing required fields: id, fieldName, dateStr.' });
  }

  const { getDailyStatusHistory } = await import('../../lib/sheets');
  const { getSheetIdBySlug }      = await import('../../lib/studies');
  const { writeDailyStatusField } = await import('../../lib/sheets-write');

  const sheetId = getSheetIdBySlug(study || '');

  // Find the Daily Status row for this participant + date
  const history = await getDailyStatusHistory(id, sheetId);
  const row = history.find(
    r => (r['Date'] || '').toString().trim().split('T')[0] === dateStr
  );

  if (!row) {
    return res.status(404).json({ success: false, error: `No Daily Status row found for ${id} on ${dateStr}.` });
  }

  // Current acknowledgments: pipe-separated column names stored on that row
  const raw      = (row['Acknowledgments'] || '').toString().trim();
  const existing = raw ? raw.split('|').map(s => s.trim()).filter(Boolean) : [];

  let updated;
  if (action === 'remove') {
    updated = existing.filter(k => k !== fieldName);
  } else {
    // 'add' (default) — deduplicate
    updated = existing.includes(fieldName) ? existing : [...existing, fieldName];
  }

  try {
    await writeDailyStatusField(id, dateStr, 'Acknowledgments', updated.join('|'));
    return res.status(200).json({ success: true, acknowledgments: updated });
  } catch (err) {
    console.error('[acknowledge] write error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Could not save acknowledgment. Check SHEET_WRITE_URL and SHEET_WRITE_SECRET env vars.',
    });
  }
}
