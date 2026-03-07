/**
 * POST /api/admin-auth
 * Body: { code: "...", study: "full-moon" }
 *
 * Verifies the admin code against the specified study's Study Config `admin_code`.
 * On success: sets a per-study session cookie (admin_session_<slug>) and
 *             the active_study cookie, then redirects to /admin.
 * On failure: redirects to /admin?error=invalid.
 *
 * Each study has its own session cookie so coordinators can be logged into
 * multiple studies at once in the same browser.
 */
export default async function handler(req, res) {
  const { getStudyConfig } = await import('../../lib/sheets');
  const { getSheetIdBySlug, getStudies } = await import('../../lib/studies');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, study } = req.body;

  // Resolve which study to auth against
  const studies   = getStudies();
  const studySlug = study || studies[0]?.slug || 'default';
  const sheetId   = getSheetIdBySlug(studySlug);

  const config    = await getStudyConfig(sheetId);
  const adminCode = (config.admin_code || '').trim();

  if (!adminCode) {
    return res.redirect(302, '/admin?error=not_configured');
  }

  if (!code || code.trim() !== adminCode) {
    return res.redirect(302, `/admin?error=invalid`);
  }

  // Set an httpOnly cookie valid for 8 hours
  // Uses a per-study cookie name so multiple studies can be active simultaneously
  const expires           = new Date(Date.now() + 8 * 60 * 60 * 1000).toUTCString();
  const sessionCookieName = `admin_session_${studySlug}`;

  res.setHeader('Set-Cookie', [
    `${sessionCookieName}=${encodeURIComponent(code.trim())}; Path=/; HttpOnly; SameSite=Strict; Expires=${expires}`,
    `active_study=${encodeURIComponent(studySlug)}; Path=/; HttpOnly; SameSite=Strict; Expires=${expires}`,
  ]);

  return res.redirect(302, '/admin');
}
