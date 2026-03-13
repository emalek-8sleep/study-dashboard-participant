/**
 * GET /api/analysis/get-runs?study=<slug>
 *
 * Fetches all saved analysis runs from the "Analysis History" tab.
 * Returns empty array gracefully if the tab doesn't exist yet.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { study } = req.query;

  try {
    const { fetchSheet }       = await import('../../../lib/sheets');
    const { getSheetIdBySlug } = await import('../../../lib/studies');

    const sheetId = getSheetIdBySlug(study || '');
    const rows    = await fetchSheet('Analysis History', sheetId);

    const runs = rows
      .filter(r => !study || (r['Study'] || '').toLowerCase() === (study || '').toLowerCase())
      .map(r => {
        // Parse resultsJson safely
        let results = null;
        try { results = JSON.parse(r['Results JSON'] || 'null'); } catch { /* ignore */ }
        return {
          id:             r['ID']             || '',
          planId:         r['Plan ID']        || '',
          createdAt:      r['Created At']     || '',
          study:          r['Study']          || '',
          planTitle:      r['Plan Title']     || '',
          codeUsed:       r['Code Used']      || '',
          results,
          interpretation: r['Interpretation'] || '',
          reportHtml:     r['Report HTML']    || '',
          status:         r['Status']         || '',
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({ runs });
  } catch (err) {
    console.warn('[get-runs] Could not fetch runs:', err.message);
    return res.status(200).json({ runs: [] });
  }
}
