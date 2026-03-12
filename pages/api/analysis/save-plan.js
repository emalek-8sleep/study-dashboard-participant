/**
 * POST /api/analysis/save-plan
 *
 * Appends a new analysis plan row to the "Analysis Plans" tab
 * via the Apps Script append_row action.
 *
 * Body: { plan, formData, activeSlug }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { plan = {}, formData = {}, activeSlug = '' } = req.body || {};
  const url = process.env.SHEET_WRITE_URL;
  if (!url) return res.status(500).json({ error: 'SHEET_WRITE_URL not set' });

  const id        = `plan_${Date.now()}`;
  const createdAt = new Date().toISOString();

  const row = [
    id,
    createdAt,
    activeSlug,
    plan.title || formData.primaryOutcome || 'Untitled Plan',
    formData.iv || '',
    formData.dv || '',
    formData.design || '',
    formData.conditions || '',
    formData.primaryOutcome || '',
    formData.secondaryOutcomes || '',
    (plan.recommendedTests || []).map(t => t.test).join(', '),
    (plan.assumptionTests || []).map(t => t.test).join(', '),
    formData.notes || '',
    'active',
    'generated',
    plan.planMarkdown || '',
  ];

  try {
    const response = await fetch(url, {
      method:   'POST',
      headers:  { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body:     JSON.stringify({ action: 'append_row', tab: 'Analysis Plans', row }),
    });

    const data = await response.json().catch(() => ({}));
    if (!data.success) throw new Error(data.error || 'Apps Script write failed');

    return res.status(200).json({ success: true, id });
  } catch (err) {
    console.error('[save-plan] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
