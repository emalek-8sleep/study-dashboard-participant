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

  const { code, study: rawStudy } = req.body;

  // Resolve which study to auth against
  // Guard against array (can happen if two form fields share the same name)
  const study     = Array.isArray(rawStudy) ? rawStudy[rawStudy.length - 1] : rawStudy;
  const studies   = getStudies();
  const studySlug = String(study || studies[0]?.slug || 'default');
  const sheetId   = getSheetIdBySlug(studySlug);

  // Prefer env var: ADMIN_CODE_<SLUG> (e.g. ADMIN_CODE_FULL_MOON) or ADMIN_CODE
  // Falls back to the sheet's admin_code value for backwards compatibility
  const slugEnvKey = `ADMIN_CODE_${studySlug.toUpperCase().replace(/-/g, '_')}`;
  const envCode    = (process.env[slugEnvKey] || process.env.ADMIN_CODE || '').trim();

  let adminCode;
  if (envCode) {
    adminCode = envCode;
  } else {
    const config = await getStudyConfig(sheetId);
    adminCode    = (config.admin_code || '').trim();
  }

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
    `${sessionCookieName}=${encodeURIComponent(code.trim())}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires}`,
    `active_study=${encodeURIComponent(studySlug)}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires}`,
  ]);

  return res.redirect(302, '/admin');
}
