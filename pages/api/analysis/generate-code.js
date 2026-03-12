/**
 * POST /api/analysis/generate-code
 *
 * Given a saved analysis plan + study metadata, uses Claude Haiku to produce
 * runnable Python code for Pyodide execution. The code must:
 *  - Use the pre-loaded `df` pandas DataFrame (already set in Pyodide globals)
 *  - Use numpy, pandas, scipy, statsmodels (available in Pyodide)
 *  - Print "RESULTS_JSON:" followed by a JSON string at the end
 *
 * Body: { plan, conditions, availableColumns, n, removedCount }
 * → { code: string }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { plan = {}, conditions = [], availableColumns = [], n = 0, removedCount = 0 } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const systemPrompt = `You are a biostatistician writing Python code for Pyodide (browser-based Python runtime).

CRITICAL REQUIREMENTS:
1. The variable \`df\` is already available as a pandas DataFrame with the study data.
2. Available packages: numpy (as np), pandas (as pd), scipy.stats, statsmodels. DO NOT import pingouin or other packages.
3. Column names must match exactly — use the ones listed in the plan.
4. At the very end, print the results as: print("RESULTS_JSON:" + json.dumps(results))
5. The results JSON must follow this exact schema:
{
  "tests": [
    {
      "name": "string — descriptive test name",
      "type": "string — ttest_paired | ttest_ind | anova | correlation | wilcoxon | mannwhitney | regression",
      "outcome": "string — DV column name",
      "predictor": "string — IV / condition",
      "statistic": number,
      "pValue": number,
      "effectSize": number or null,
      "effectSizeType": "string — Cohens_d | r | eta_squared | omega_squared | null",
      "significant": boolean,
      "direction": "string — which condition was higher / direction of effect",
      "details": "string — full stats string e.g. t(19) = 3.24, p = .023, d = 0.68",
      "chartData": [{"label": "string", "mean": number, "sd": number, "n": number, "ci95_low": number, "ci95_high": number}]
    }
  ],
  "assumptions": [
    {
      "test": "string",
      "variable": "string",
      "condition": "string or null",
      "statistic": number,
      "pValue": number,
      "passed": boolean,
      "interpretation": "string"
    }
  ],
  "descriptives": [
    {
      "variable": "string",
      "condition": "string",
      "n": number,
      "mean": number,
      "sd": number,
      "median": number,
      "min": number,
      "max": number
    }
  ]
}
6. Handle missing/NaN values gracefully with dropna().
7. For within-subjects / crossover designs, use paired tests.
8. Add a comment block at the top explaining the analysis approach.
9. Respond with ONLY the Python code — no markdown fences, no explanation.`;

  const userMessage = `Generate Python analysis code for this study:

ANALYSIS PLAN TITLE: ${plan.title || 'Untitled'}
STUDY DESIGN: ${plan.design || plan.formData?.design || 'Not specified'}
INDEPENDENT VARIABLE: ${plan.iv || plan.formData?.iv || 'Not specified'}
DEPENDENT VARIABLES: ${plan.dv || plan.formData?.dv || 'Not specified'}
CONDITIONS: ${conditions.join(', ') || plan.conditions || 'Not specified'}
COVARIATES: ${plan.covariates || plan.formData?.covariates || 'None'}
PRIMARY OUTCOME: ${plan.primaryOutcome || plan.formData?.primaryOutcome || 'Not specified'}
SECONDARY OUTCOMES: ${plan.secondaryOutcomes || plan.formData?.secondaryOutcomes || 'None'}
RECOMMENDED TESTS: ${Array.isArray(plan.recommendedTests)
    ? plan.recommendedTests.map(t => `${t.test} (${t.variables?.outcome} ~ ${t.variables?.predictor})`).join('; ')
    : plan.statisticalTests || 'Per plan'}
ASSUMPTION TESTS: ${Array.isArray(plan.assumptionTests)
    ? plan.assumptionTests.map(t => t.test).join(', ')
    : plan.assumptionTestsList || 'Normality, homogeneity of variance'}
SAMPLE SIZE: n = ${n} (${removedCount} data points excluded by reviewer)
AVAILABLE COLUMNS: ${availableColumns.join(', ')}

The DataFrame \`df\` has these columns: ${availableColumns.join(', ')}
The 'Condition' column contains: ${conditions.join(', ')}
The 'Subject ID' column identifies participants.

Generate complete, runnable Python code.`;

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
        max_tokens: 4096,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[generate-code] Anthropic error:', err);
      return res.status(500).json({ error: 'Claude API error' });
    }

    const data = await response.json();
    let code = data.content?.[0]?.text || '';

    // Strip markdown code fences if Claude wrapped anyway
    code = code.replace(/^```(?:python)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    return res.status(200).json({ code });
  } catch (err) {
    console.error('[generate-code] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
