/**
 * POST /api/analysis/interpret
 *
 * Sends analysis results to Claude Sonnet for expert interpretation.
 * Uses Sonnet (not Haiku) for quality-critical narrative generation.
 *
 * Body: { plan, resultsJson, descriptives, removedCount, studySlug }
 * → { interpretation: string (markdown) }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { plan = {}, resultsJson = {}, removedCount = 0, studySlug = '' } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const tests       = resultsJson.tests || [];
  const assumptions = resultsJson.assumptions || [];
  const descriptives = resultsJson.descriptives || [];

  const systemPrompt = `You are a biostatistician and clinical research expert specializing in sleep science and wearable device studies. Your role is to provide clear, rigorous, publication-quality interpretation of statistical results.

Write in plain scientific English — no jargon without explanation. Be honest about limitations. Format your response as clean markdown with these exact sections:

## Summary of Findings
2–4 sentences summarizing the key results in plain language for a clinical audience.

## Statistical Results
For each test: interpret the direction of effect, magnitude (effect size), and statistical significance. Note whether the finding is clinically meaningful (not just statistically significant).

## Assumption Check Results
Note whether assumptions were met and if not, what that means for interpretation.

## Limitations & Caveats
Sample size, excluded data points, design constraints, multiple comparisons.

## Clinical Significance
Translate findings into practical terms — what does this mean for the study population?

Keep it concise and focused. Avoid restating the numbers (those are already visible) — focus on meaning.`;

  const testSummary = tests.map(t =>
    `• ${t.name}: ${t.details} — ${t.significant ? `SIGNIFICANT (${t.direction})` : 'NOT significant'}, effect size = ${t.effectSize?.toFixed(3) ?? 'N/A'} (${t.effectSizeType || ''})`
  ).join('\n');

  const assumptionSummary = assumptions.map(a =>
    `• ${a.test} on ${a.variable}${a.condition ? ` (${a.condition})` : ''}: ${a.passed ? 'PASSED' : 'FAILED'} — ${a.interpretation}`
  ).join('\n');

  const descSummary = descriptives.slice(0, 12).map(d =>
    `• ${d.variable} [${d.condition}]: n=${d.n}, M=${d.mean?.toFixed(2)}, SD=${d.sd?.toFixed(2)}, range ${d.min?.toFixed(2)}–${d.max?.toFixed(2)}`
  ).join('\n');

  const userMessage = `Please interpret these analysis results for the study "${plan.title || studySlug}".

STUDY DESIGN: ${plan.design || 'Not specified'}
IV: ${plan.iv || 'Not specified'} | DVs: ${plan.dv || 'Not specified'}
${removedCount > 0 ? `NOTE: ${removedCount} data point(s) were excluded by the researcher as outliers prior to analysis.` : ''}

STATISTICAL TEST RESULTS:
${testSummary || 'No test results available.'}

ASSUMPTION CHECKS:
${assumptionSummary || 'No assumption check results available.'}

DESCRIPTIVE STATISTICS:
${descSummary || 'No descriptive statistics available.'}

Please provide a comprehensive interpretation.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[interpret] Anthropic error:', err);
      return res.status(500).json({ error: 'Claude API error' });
    }

    const data = await response.json();
    const interpretation = data.content?.[0]?.text || '';

    return res.status(200).json({ interpretation });
  } catch (err) {
    console.error('[interpret] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
