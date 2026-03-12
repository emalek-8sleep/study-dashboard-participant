/**
 * POST /api/log-login
 *
 * Called automatically when a participant loads their dashboard.
 * Updates the "Last Login" column in the Participants tab via the
 * existing writeParticipantField mechanism — no Apps Script changes needed.
 *
 * Body: { id, study }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, study } = req.body || {};

  if (!id) {
    return res.status(400).json({ success: false, error: 'Missing required field: id' });
  }

  const now = new Date();
  const readableTime = now.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  console.log('[log-login] Recording login:', { id, study, readableTime });

  try {
    const { writeParticipantField } = await import('../../lib/sheets-write');
    await writeParticipantField(id, 'Last Login', readableTime);
    console.log('[log-login] Success:', { id, readableTime });
    return res.status(200).json({ success: true });
  } catch (err) {
    // Non-fatal — log but don't surface to the user
    console.error('[log-login] Failed to write Last Login:', {
      id,
      error: err.message,
    });
    return res.status(200).json({ success: false, error: err.message });
  }
}
