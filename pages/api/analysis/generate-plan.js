/**
 * POST /api/analysis/generate-plan
 *
 * Takes study design inputs and reference DAPs, returns a structured
 * analysis plan with recommended statistical tests and assumption checks.
 *
 * Uses Claude Haiku (cost-optimized) — sends only metadata, never raw data rows.
 *
 * Body: { formData, availableColumns, studyData, referenceDAPs }
 * → { plan: { title, recommendedTests, assumptionTests, planMarkdown, ... } }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { formData = {}, availableColumns = [], studyData = {}, referenceDAPs = [] } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  // ── Build reference context (style learning from uploaded/saved DAPs) ─────
  const refContext = referenceDAPs.length > 0
    ? `\n\nREFERENCE ANALYSIS PLANS (use these to match our team's style and preferences):\n` +
      referenceDAPs.slice(0, 3).map((d, i) =>
        `--- Plan ${i + 1}: ${d.title || 'Untitled'} ---\n${(d.fullText || '').slice(0, 800)}`
      ).join('\n\n')
    : '';

  const systemPrompt = `You are a biostatistician and clinical research expert specializing in sleep science and wearable device studies. Your role is to generate rigorous, well-justified statistical analysis plans.

You must respond with a valid JSON object only — no markdown fences, no extra text. The JSON must match this exact schema:
{
  "title": "string — concise descriptive title for this analysis plan",
  "recommendedTests": [
    {
      "test": "string — full test name",
      "rationale": "string — why this test is appropriate given the design",
      "variables": { "outcome": "string", "predictor": "string", "covariates": "string or null" },
      "software": "string — e.g. scipy.stats, pingouin, statsmodels"
    }
  ],
  "assumptionTests": [
    {
      "test": "string — e.g. Shapiro-Wilk normality test",
      "variable": "string",
      "threshold": "string — e.g. p > 0.05 indicates normality",
      "failAction": "string — what to do if assumption is violated"
    }
  ],
  "multipleComparisons": "string — correction needed? Bonferroni / FDR / none, with rationale",
  "effectSizes": "string — which effect size metrics to report for each test",
  "powerConsiderations": "string — brief note on statistical power given n",
  "interpretationNotes": "string — key caveats and interpretation guidance",
  "planMarkdown": "string — concise analysis plan in markdown format (aim for ~600 words max), professional and publication-ready. Cover rationale, methods, and key caveats. Do not repeat everything from the other fields."
}${refContext}`;

  const userMessage = `Generate a complete statistical analysis plan for the following study:

STUDY DESIGN: ${formData.design || 'Not specified'}
INDEPENDENT VARIABLE(S): ${formData.iv || 'Not specified'}
DEPENDENT VARIABLE(S): ${formData.dv || 'Not specified'}
CONDITIONS/GROUPS: ${formData.conditions || 'Not specified'}
COVARIATES: ${formData.covariates || 'None'}
PRIMARY OUTCOME: ${formData.primaryOutcome || 'Not specified'}
SECONDARY OUTCOMES: ${formData.secondaryOutcomes || 'None'}
HYPOTHESIS: ${formData.hypothesis || 'Not specified'}
SAMPLE SIZE: n = ${studyData.n || 'Unknown'}
AVAILABLE DATA COLUMNS: ${availableColumns.join(', ') || 'Not specified'}
ADDITIONAL NOTES: ${formData.notes || 'None'}

Generate the full analysis plan. Be specific about which columns map to which variables. Flag any concerns about statistical power given the sample size.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 8096,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[generate-plan] Anthropic error:', err);
      return res.status(500).json({ error: 'Claude API error' });
    }

    const data = await response.json();
    const raw  = data.content?.[0]?.text || '{}';

    // Warn if response was truncated due to token limit
    if (data.stop_reason === 'max_tokens') {
      console.warn('[generate-plan] Response truncated at max_tokens — attempting recovery');
    }

    let plan;
    try {
      plan = JSON.parse(raw);
    } catch {
      // Try stripping markdown fences first
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        try { plan = JSON.parse(fenceMatch[1]); } catch { /* fall through */ }
      }

      // If still no plan, try to recover a truncated JSON by extracting what we can
      if (!plan) {
        try {
          // Pull out any complete top-level string fields we can find
          const extract = (key) => {
            const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
            return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '';
          };
          plan = {
            title:                extract('title') || 'Analysis Plan (truncated)',
            planMarkdown:         extract('planMarkdown') || raw,
            multipleComparisons:  extract('multipleComparisons') || '',
            effectSizes:          extract('effectSizes') || '',
            powerConsiderations:  extract('powerConsiderations') || '',
            interpretationNotes:  extract('interpretationNotes') || '',
            recommendedTests:     [],
            assumptionTests:      [],
            _truncated:           true,
          };
          // Try to parse out recommendedTests array
          const testsMatch = raw.match(/"recommendedTests"\s*:\s*(\[[\s\S]*?\])\s*,/);
          if (testsMatch) { try { plan.recommendedTests = JSON.parse(testsMatch[1]); } catch { /* ignore */ } }
        } catch {
          plan = { planMarkdown: raw, _truncated: true };
        }
      }
    }

    return res.status(200).json({ plan });
  } catch (err) {
    console.error('[generate-plan] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
