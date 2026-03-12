/**
 * POST /api/comment
 * Body: { subjectId: string, comment: string }
 *
 * Forwards the comment to a Google Apps Script Web App that appends
 * a new row to the "Comments" tab in the Google Sheet.
 *
 * The Apps Script URL must be set in Study Config as `comments_script_url`.
 *
 * Returns { success: true } or { error: '...' }
 */
import { getStudyConfig } from '../../lib/sheets';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { subjectId, comment } = req.body || {};

  if (!subjectId || !comment?.trim()) {
    return res.status(400).json({ error: 'Subject ID and comment are required.' });
  }
  if (comment.trim().length > 2000) {
    return res.status(400).json({ error: 'Comment is too long (max 2000 characters).' });
  }

  const config = await getStudyConfig();
  const scriptUrl = (config.comments_script_url || '').trim();

  console.log('[comment] comments_script_url from config:', scriptUrl ? `${scriptUrl.slice(0, 60)}...` : '(empty)');

  if (!scriptUrl) {
    console.log('[comment] No comments_script_url configured — returning 503');
    return res.status(503).json({ error: 'Comments are not yet configured for this study.' });
  }

  const payload = {
    subjectId: String(subjectId).trim(),
    comment: comment.trim(),
  };
  console.log('[comment] Sending to Apps Script:', JSON.stringify(payload));

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    console.log('[comment] Apps Script HTTP status:', response.status, response.statusText);
    console.log('[comment] Final URL after redirects:', response.url);

    // Apps Script returns JSON — parse it
    const text = await response.text();
    console.log('[comment] Raw Apps Script response:', text.slice(0, 500));

    let result = {};
    try { result = JSON.parse(text); } catch (parseErr) {
      console.error('[comment] JSON parse error:', parseErr.message, '| raw text:', text.slice(0, 200));
    }

    console.log('[comment] Parsed result:', JSON.stringify(result));

    if (result.success) {
      return res.status(200).json({ success: true });
    }

    console.error('[comment] Apps Script returned failure:', result);
    return res.status(500).json({ error: 'Failed to save your comment. Please try again.' });
  } catch (err) {
    console.error('[comment] Fetch/network error:', err.message, err.stack);
    return res.status(500).json({ error: 'Network error. Please try again.' });
  }
}
