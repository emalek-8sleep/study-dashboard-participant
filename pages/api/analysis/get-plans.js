/**
 * GET /api/analysis/get-plans?study=<slug>
 *
 * Fetches all saved analysis plans from the "Analysis Plans" tab.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { study } = req.query;

  try {
    const { fetchSheet }      = await import('../../../lib/sheets');
    const { getSheetIdBySlug } = await import('../../../lib/studies');

    const sheetId = getSheetIdBySlug(study || '');
    const rows    = await fetchSheet('Analysis Plans', sheetId);

    // Filter to this study's plans
    const plans = rows.filter(r =>
      !study || (r['Study'] || '').toLowerCase() === (study || '').toLowerCase()
    );

    return res.status(200).json({ plans });
  } catch (err) {
    // Tab may not exist yet — return empty array gracefully
    console.warn('[get-plans] Could not fetch plans:', err.message);
    return res.status(200).json({ plans: [] });
  }
}
