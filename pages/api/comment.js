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
  // Prefer data_analysis_comments_script_url (for the duplicated Vercel project),
  // fall back to comments_script_url if not set.
  const scriptUrl = (config.data_analysis_comments_script_url || config.comments_script_url || '').trim();

  if (!scriptUrl) {
    return res.status(503).json({ error: 'Comments are not yet configured for this study.' });
  }

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subjectId: String(subjectId).trim(),
        comment: comment.trim(),
      }),
    });

    // Apps Script returns JSON — parse it
    const text = await response.text();
    let result = {};
    try { result = JSON.parse(text); } catch { /* ignore parse errors */ }

    if (result.success) {
      return res.status(200).json({ success: true });
    }

    console.error('Apps Script error:', result);
    return res.status(500).json({ error: 'Failed to save your comment. Please try again.' });
  } catch (err) {
    console.error('Comment submission error:', err);
    return res.status(500).json({ error: 'Network error. Please try again.' });
  }
}
