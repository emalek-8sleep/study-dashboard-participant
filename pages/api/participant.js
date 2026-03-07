/**
 * GET /api/participant?id=SBJ-001[&verify=<value>]
 *
 * Returns { found: true, name: '...' } or { found: false }
 *
 * If the Study Config has a `verification_field` key set (e.g. "Date of Birth"),
 * the `verify` query param is required and must match that column in the Participants
 * sheet (case-insensitive, trimmed). This adds a second factor beyond Subject ID.
 *
 * Used by the login page to validate identity before navigating to the dashboard.
 */
import { getParticipant, getStudyConfig } from '../../lib/sheets';

export default async function handler(req, res) {
  const { id, verify } = req.query;
  if (!id) return res.status(400).json({ found: false, error: 'Missing id param' });

  // Fetch participant and config in parallel
  const [participant, config] = await Promise.all([
    getParticipant(id),
    getStudyConfig(),
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

  return res.status(200).json({
    found: true,
    name: participant['First Name'] || null,
  });
}

function normalize(str) {
  return (str || '').toString().trim().toLowerCase();
}
