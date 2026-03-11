/**
 * /api/admin/chat
 *
 * Sends a coordinator question to Claude along with a rich context block
 * built from the current study stats (phase breakdown, field-level check-in
 * summary, participant issue counts, etc.).
 *
 * POST { messages: [{role, content}], stats: {...}, study: slug }
 * → { reply: string }
 *
 * Requires ANTHROPIC_API_KEY env var.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages = [], stats = {}, study = '', metrics = [] } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set.' });
  }

  // ── Build context for Claude ─────────────────────────────────────────────
  const lines = [
    `You are a helpful assistant for a clinical research coordinator at Eight Sleep.`,
    `You have access to the following real-time study data:`,
    ``,
    `STUDY: ${study || 'Unknown'}`,
    ``,
    `PARTICIPANT COUNTS:`,
    `  Total enrolled: ${stats.total ?? 'N/A'}`,
    `  With check-in issues last night: ${stats.withIssues ?? 'N/A'}`,
    `  No data submitted last night: ${stats.noData ?? 'N/A'}`,
    `  Open questions/comments: ${stats.openComments ?? 'N/A'}`,
    `  All checks passed: ${stats.allGood ?? 'N/A'}`,
  ];

  if (stats.phaseBreakdown?.length) {
    lines.push(``, `PHASE BREAKDOWN:`);
    stats.phaseBreakdown.forEach(({ phase, count }) => {
      lines.push(`  ${phase}: ${count} participant${count === 1 ? '' : 's'}`);
    });
  }

  if (stats.fieldStats?.length) {
    lines.push(``, `LAST NIGHT'S CHECK-IN FIELD RESULTS:`);
    stats.fieldStats.forEach(({ label, valid, invalid, noData }) => {
      lines.push(`  ${label}: ${valid} valid, ${invalid} issues, ${noData} no data`);
    });
  }

  // ── Metrics context ───────────────────────────────────────────────────────
  if (metrics.length > 0) {
    // Discover metric columns (everything except Subject ID and Date)
    const metricCols = Object.keys(metrics[0]).filter(
      (k) => k !== 'Subject ID' && k !== 'Date'
    );

    // Aggregate stats per column
    const aggStats = {};
    metricCols.forEach((col) => {
      const vals = metrics.map((m) => parseFloat(m[col])).filter((v) => !isNaN(v));
      if (vals.length) {
        const sum = vals.reduce((a, b) => a + b, 0);
        aggStats[col] = {
          min: Math.min(...vals),
          max: Math.max(...vals),
          avg: +(sum / vals.length).toFixed(2),
          n:   vals.length,
        };
      }
    });

    // Most recent reading per participant
    const latestByPid = {};
    metrics.forEach((m) => {
      const pid = m['Subject ID'];
      if (!latestByPid[pid] || new Date(m['Date']) > new Date(latestByPid[pid]['Date'])) {
        latestByPid[pid] = m;
      }
    });

    lines.push(``, `BACKEND METRICS DATA:`);
    lines.push(`  Metrics available: ${metricCols.join(', ')}`);
    lines.push(`  Total readings: ${metrics.length} across ${Object.keys(latestByPid).length} participants`);

    if (metricCols.length > 0) {
      lines.push(``, `  AGGREGATE STATS (all readings):`);
      metricCols.forEach((col) => {
        const s = aggStats[col];
        if (s) lines.push(`    ${col}: avg=${s.avg}, min=${s.min}, max=${s.max}, n=${s.n}`);
        else   lines.push(`    ${col}: (non-numeric)`);
      });
    }

    // Latest reading per participant — cap at 40 to avoid token bloat
    const pids = Object.keys(latestByPid);
    lines.push(``, `  LATEST READING PER PARTICIPANT (${Math.min(pids.length, 40)} of ${pids.length}):`);
    pids.slice(0, 40).forEach((pid) => {
      const row = latestByPid[pid];
      const dateStr = row['Date'] ? row['Date'].toString().split('T')[0] : '?';
      const vals = metricCols.map((col) => `${col}=${row[col] ?? '—'}`).join(', ');
      lines.push(`    ${pid} (${dateStr}): ${vals}`);
    });

    // Full history for studies with fewer rows — include all if <= 100 rows
    if (metrics.length <= 100 && metrics.length > Object.keys(latestByPid).length) {
      lines.push(``, `  FULL HISTORY (all ${metrics.length} readings):`);
      metrics.forEach((row) => {
        const dateStr = row['Date'] ? row['Date'].toString().split('T')[0] : '?';
        const vals = metricCols.map((col) => `${col}=${row[col] ?? '—'}`).join(', ');
        lines.push(`    ${row['Subject ID']} (${dateStr}): ${vals}`);
      });
    }
  }

  lines.push(
    ``,
    `Use this data to answer the coordinator's questions accurately and concisely.`,
    `When asked about metrics, reason over the data provided and highlight anything`,
    `that looks unusual or worth attention. Use a clear, professional tone suitable`,
    `for sharing with the research team. Keep responses focused and practical.`
  );

  const systemPrompt = lines.join('\n');

  // ── Call Anthropic API ───────────────────────────────────────────────────
  // Filter to user/assistant turns only (skip any system messages from client)
  const apiMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   apiMessages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[admin/chat] Anthropic error:', errText);
      return res.status(500).json({ error: 'Claude API error. Check server logs.' });
    }

    const data  = await response.json();
    const reply = data.content?.[0]?.text || 'No response from Claude.';
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('[admin/chat] fetch error:', err.message);
    return res.status(500).json({ error: 'Could not reach Claude API.' });
  }
}
