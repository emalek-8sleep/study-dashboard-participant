/**
 * GET /api/participant?id=SBJ-001&study=full-moon[&verify=<value>]
 *
 * Returns { found: true, name: '...' } or { found: false }
 *
 * The `study` param is the study slug (e.g. "full-moon"). It determines which
 * Google Sheet to look up the participant in. Defaults to the first configured study.
 *
 * On success, sets an `active_study` httpOnly cookie so subsequent pages
 * (dashboard, resources, setup) automatically load from the correct sheet.
 *
 * If the Study Config has a `verification_field` key set (e.g. "Date of Birth"),
 * the `verify` query param is required and must match that column in Participants.
 */
export default async function handler(req, res) {
  const { getParticipant, getStudyConfig } = await import('../../lib/sheets');
  const { getSheetIdBySlug } = await import('../../lib/studies');

  // Prevent browser/Vercel CDN from caching participant lookups
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  const { id, verify, study } = req.query;
  if (!id) return res.status(400).json({ found: false, error: 'Missing id param' });

  // Resolve the sheet ID for the requested study
  const sheetId = getSheetIdBySlug(study || '');

  // Fetch participant and config from the correct study sheet in parallel
  const [participant, config] = await Promise.all([
    getParticipant(id, sheetId),
    getStudyConfig(sheetId),
  ]);

  if (!participant) return res.status(200).json({ found: false });

  // If a verification field is configured, check it
  const verificationField = (config.verification_field || '').trim();
  if (verificationField) {
    const expected = normalize(participant[verificationField] || '');
    const provided = normalize(verify || '');
    // Return the same generic "not found" so we don't reveal which field was wrong
    if (!provided || expected !== provided) {
      return res.status(200).json({ found: false });
    }
  }

  // Set the active_study cookie so all pages know which sheet to use
  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toUTCString();
  const studySlug = study || 'default';
  res.setHeader('Set-Cookie', [
    `active_study=${encodeURIComponent(studySlug)}; Path=/; HttpOnly; SameSite=Strict; Expires=${expires}`,
  ]);

  return res.status(200).json({
    found: true,
    name: participant['First Name'] || null,
  });
}

function normalize(str) {
  return (str || '').toString().trim().toLowerCase();
}
