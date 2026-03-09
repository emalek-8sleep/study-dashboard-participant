/**
 * GET /api/logout
 *
 * Expires both session cookies (active_study + participant_id) and redirects
 * the user to the login page. Always redirects — never returns JSON.
 */
export default function handler(req, res) {
  const past = 'Thu, 01 Jan 1970 00:00:00 GMT';

  res.setHeader('Set-Cookie', [
    `active_study=; Path=/; HttpOnly; SameSite=Strict; Expires=${past}`,
    `participant_id=; Path=/; HttpOnly; SameSite=Strict; Expires=${past}`,
  ]);

  res.redirect(302, '/');
}
