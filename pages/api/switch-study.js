/**
 * POST /api/switch-study
 * Body: { study: "orbit" }
 *
 * Updates the active_study cookie and redirects back to /admin.
 * The admin page will then load data from the newly selected study.
 *
 * If the coordinator hasn't logged into that study yet, they'll be prompted
 * for the admin code on the /admin page (since their session cookie for that
 * study won't exist yet).
 */
import { getStudies } from '../../lib/studies';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { study } = req.body;

  // Validate that the study slug is one we actually know about
  const studies = getStudies();
  const valid   = studies.find((s) => s.slug === study);
  if (!valid) {
    return res.redirect(302, '/admin');
  }

  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toUTCString();
  res.setHeader('Set-Cookie', [
    `active_study=${encodeURIComponent(study)}; Path=/; HttpOnly; SameSite=Strict; Expires=${expires}`,
  ]);

  return res.redirect(302, '/admin');
}
