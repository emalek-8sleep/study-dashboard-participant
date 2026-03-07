/**
 * POST /api/admin-auth
 * Body: { code: "..." }
 *
 * Verifies the admin code against Study Config's `admin_code` key.
 * On success: sets an httpOnly session cookie and redirects to /admin.
 * On failure: redirects to /admin?error=invalid.
 */
import { getStudyConfig } from '../../lib/sheets';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.body;
  const config = await getStudyConfig();
  const adminCode = (config.admin_code || '').trim();

  if (!adminCode) {
    // No admin code configured — deny access
    return res.redirect(302, '/admin?error=not_configured');
  }

  if (!code || code.trim() !== adminCode) {
    return res.redirect(302, '/admin?error=invalid');
  }

  // Set an httpOnly cookie valid for 8 hours
  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toUTCString();
  res.setHeader('Set-Cookie', [
    `admin_session=${encodeURIComponent(code.trim())}; Path=/; HttpOnly; SameSite=Strict; Expires=${expires}`,
  ]);

  return res.redirect(302, '/admin');
}
