/**
 * POST /api/analysis/save-run
 *
 * Appends a completed analysis run to the "Analysis History" tab
 * via the Apps Script append_row action.
 *
 * Body: { planId, planTitle, study, codeUsed, resultsJson, interpretation, reportHtml, status }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    planId       = '',
    planTitle    = '',
    study        = '',
    codeUsed     = '',
    resultsJson  = {},
    interpretation = '',
    reportHtml   = '',
    status       = 'completed',
  } = req.body || {};

  const url = process.env.SHEET_WRITE_URL;
  if (!url) return res.status(500).json({ error: 'SHEET_WRITE_URL not set' });

  const id        = `run_${Date.now()}`;
  const createdAt = new Date().toISOString();

  // Analysis History headers: ID | Plan ID | Created At | Study | Plan Title |
  //   Code Used | Results JSON | Interpretation | Report HTML | Status
  const row = [
    id,
    planId,
    createdAt,
    study,
    planTitle,
    codeUsed,
    typeof resultsJson === 'string' ? resultsJson : JSON.stringify(resultsJson),
    interpretation,
    reportHtml,
    status,
  ];

  try {
    const response = await fetch(url, {
      method:   'POST',
      headers:  { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body:     JSON.stringify({ action: 'append_row', tab: 'Analysis History', row }),
    });

    const data = await response.json().catch(() => ({}));
    if (!data.success) throw new Error(data.error || 'Apps Script write failed');

    return res.status(200).json({ success: true, id });
  } catch (err) {
    console.error('[save-run] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
