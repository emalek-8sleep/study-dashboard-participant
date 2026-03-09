/**
 * /api/acknowledge
 *
 * Toggles an acknowledgment on a "needs attention" check-in field.
 * Acknowledgments are stored in the Participants sheet in an "Acknowledgments"
 * column as a pipe-separated list of "fieldName_YYYY-MM-DD" tokens.
 *
 * POST /api/acknowledge
 *   Body: { id, study, fieldName, dateStr, action: 'add' | 'remove' }
 *   → { success: true, acknowledgments: string[] }
 *
 * The column is created automatically by the Apps Script if it doesn't exist.
 * Format: "hrv_2026-03-08|rhr_2026-03-07"  (pipe-separated, no spaces)
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

  const { getParticipant }        = await import('../../lib/sheets');
  const { getSheetIdBySlug }      = await import('../../lib/studies');
  const { writeParticipantField } = await import('../../lib/sheets-write');

  const sheetId     = getSheetIdBySlug(study || '');
  const participant = await getParticipant(id, sheetId);

  if (!participant) {
    return res.status(404).json({ success: false, error: 'Participant not found.' });
  }

  // Current acknowledgments: pipe-separated "colName_YYYY-MM-DD" tokens
  const raw      = (participant['Acknowledgments'] || '').toString().trim();
  const existing = raw ? raw.split('|').map(s => s.trim()).filter(Boolean) : [];
  const key      = `${fieldName}_${dateStr}`;

  let updated;
  if (action === 'remove') {
    updated = existing.filter(k => k !== key);
  } else {
    // 'add' (default) — deduplicate
    updated = existing.includes(key) ? existing : [...existing, key];
  }

  try {
    await writeParticipantField(id, 'Acknowledgments', updated.join('|'), sheetId);
    return res.status(200).json({ success: true, acknowledgments: updated });
  } catch (err) {
    console.error('[acknowledge] write error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Could not save acknowledgment. Check SHEET_WRITE_URL and SHEET_WRITE_SECRET env vars.',
    });
  }
}
