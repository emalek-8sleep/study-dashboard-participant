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

  const { messages = [], stats = {}, study = '' } = req.body || {};

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

  lines.push(
    ``,
    `Use this data to answer the coordinator's questions accurately and concisely.`,
    `When generating a status update, use a clear, professional tone suitable for`,
    `sharing with the research team. Keep responses focused and practical.`
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
