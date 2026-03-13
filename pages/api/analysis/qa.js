/**
 * POST /api/analysis/qa
 *
 * Stakeholder Q&A — answers questions about a completed analysis run.
 * Uses Claude Sonnet with the run's results and interpretation as context.
 *
 * Body: {
 *   question:       string,
 *   history:        [{ role, content }],   // prior Q&A turns
 *   planTitle:      string,
 *   resultsJson:    object,
 *   interpretation: string,
 *   studySlug:      string,
 * }
 * → { answer: string (markdown) }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    question       = '',
    history        = [],
    planTitle      = '',
    resultsJson    = {},
    interpretation = '',
    studySlug      = '',
  } = req.body || {};

  if (!question.trim()) return res.status(400).json({ error: 'Question is required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  // ── Build context summary from results ───────────────────────────────────
  const tests       = (resultsJson?.tests       || []);
  const assumptions = (resultsJson?.assumptions || []);
  const descriptives = (resultsJson?.descriptives || []);

  const testContext = tests.map(t =>
    `• ${t.name}: ${t.details} | ${t.significant ? `SIGNIFICANT — ${t.direction}` : 'not significant'} | effect size ${t.effectSize?.toFixed(3) ?? 'N/A'} (${t.effectSizeType || ''})`
  ).join('\n');

  const assumContext = assumptions.map(a =>
    `• ${a.test} on ${a.variable}${a.condition ? ` [${a.condition}]` : ''}: ${a.passed ? 'passed' : 'FAILED'} — ${a.interpretation}`
  ).join('\n');

  const descContext = descriptives.slice(0, 10).map(d =>
    `• ${d.variable} [${d.condition}]: n=${d.n}, M=${d.mean?.toFixed(2)}, SD=${d.sd?.toFixed(2)}`
  ).join('\n');

  const systemPrompt = `You are a biostatistician and clinical research expert answering questions about a completed statistical analysis for a sleep science study.

You have access to the full analysis results and an expert interpretation. Answer questions clearly and accurately — explain statistical concepts in plain language when needed, and be honest about limitations or uncertainty.

Keep answers focused and concise (2–5 sentences for simple questions, longer only if needed). Use markdown for structure when helpful.

ANALYSIS CONTEXT:
Plan: ${planTitle} | Study: ${studySlug}

STATISTICAL RESULTS:
${testContext || 'No test results available.'}

ASSUMPTION CHECKS:
${assumContext || 'No assumption checks available.'}

DESCRIPTIVE STATISTICS:
${descContext || 'No descriptive stats available.'}

EXPERT INTERPRETATION:
${interpretation ? interpretation.slice(0, 1200) : 'No interpretation available.'}`;

  // Build message history (cap at last 10 turns to stay within context)
  const priorMessages = history.slice(-10).map(m => ({
    role:    m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  const messages = [
    ...priorMessages,
    { role: 'user', content: question.trim() },
  ];

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
        max_tokens: 1024,
        system:     systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[qa] Anthropic error:', err);
      return res.status(500).json({ error: 'Claude API error' });
    }

    const data   = await response.json();
    const answer = data.content?.[0]?.text || '';

    return res.status(200).json({ answer });
  } catch (err) {
    console.error('[qa] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
