/**
 * /api/pin
 *
 * Handles participant PIN operations.
 *
 * GET  /api/pin?id=SBJ-001&study=slug
 *   → { hasPin: boolean }
 *     Checks whether this participant already has a PIN set.
 *
 * POST /api/pin  { id, study, action: 'set', pin }
 *   → { success: true } + sets session cookie
 *     Creates or updates the participant's PIN. No auth required — the
 *     participant must already have passed subject ID verification.
 *
 * POST /api/pin  { id, study, action: 'verify', pin }
 *   → { success: true }  + sets session cookie  (on correct PIN)
 *   → { success: false, error: '...' }           (on wrong PIN)
 *
 * The PIN is stored in a "PIN" column in the Participants tab of the
 * Google Sheet. Plain text (4 digits) so coordinators can retrieve it.
 *
 * Rate limiting: tracks failed attempts in a cookie (max 5 tries, 15-min lockout).
 */

export default async function handler(req, res) {
  const { getParticipant, getStudyConfig } = await import('../../lib/sheets');
  const { getSheetIdBySlug }               = await import('../../lib/studies');

  // ── GET: does this participant have a PIN? ─────────────────────────────────
  if (req.method === 'GET') {
    const { id, study } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const sheetId     = getSheetIdBySlug(study || '');
    const participant = await getParticipant(id, sheetId);

    if (!participant) return res.status(200).json({ hasPin: false });

    // Pad to 4 digits only if a PIN was actually stored — handles Sheets collapsing
    // leading-zero PINs (e.g. 0000 → stored as number 0 → string '0').
    // An empty cell must stay empty so hasPin comes back false for new participants.
    const rawPin = (participant['PIN'] || '').toString().trim();
    const pin    = rawPin ? rawPin.padStart(4, '0') : '';
    return res.status(200).json({ hasPin: pin.length === 4 && /^\d{4}$/.test(pin) });
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { id, study, action, pin } = req.body || {};

    if (!id || !action || !pin) {
      return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }

    // Validate PIN format
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ success: false, error: 'PIN must be exactly 4 digits.' });
    }

    const sheetId     = getSheetIdBySlug(study || '');
    const participant = await getParticipant(id, sheetId);

    if (!participant) {
      return res.status(200).json({ success: false, error: 'Participant not found.' });
    }

    // ── action: 'set' — create/update PIN ───────────────────────────────────
    if (action === 'set') {
      try {
        const { writeParticipantField } = await import('../../lib/sheets-write');
        await writeParticipantField(id, 'PIN', pin, sheetId);
        setSessionCookie(res, id, study || 'default');
        return res.status(200).json({ success: true });
      } catch (err) {
        console.error('[pin] set error:', err.message);
        return res.status(500).json({ success: false, error: 'Could not save PIN. Check server configuration.' });
      }
    }

    // ── action: 'verify' — check PIN ────────────────────────────────────────
    if (action === 'verify') {
      // Rate limiting via cookie
      const cookies   = parseCookies(req.headers.cookie || '');
      const failKey   = `pin_fails_${id.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const failData  = parseFailData(cookies[failKey]);

      if (failData.locked) {
        const remaining = Math.ceil((failData.until - Date.now()) / 60000);
        return res.status(429).json({
          success: false,
          error: `Too many attempts. Try again in ${remaining} minute${remaining === 1 ? '' : 's'}.`,
          locked: true,
        });
      }

      // Pad stored PIN only if a value exists — same logic as the hasPin check above
      const rawStored = (participant['PIN'] || '').toString().trim();
      const storedPin = rawStored ? rawStored.padStart(4, '0') : '';
      if (storedPin !== pin) {
        // Record failed attempt
        const attempts = (failData.attempts || 0) + 1;
        const locked   = attempts >= 5;
        const until    = locked ? Date.now() + 15 * 60 * 1000 : 0;
        const expires  = locked
          ? new Date(until).toUTCString()
          : new Date(Date.now() + 60 * 60 * 1000).toUTCString();

        res.setHeader('Set-Cookie',
          `${failKey}=${JSON.stringify({ attempts, locked, until })}; Path=/; HttpOnly; SameSite=Strict; Expires=${expires}`
        );

        if (locked) {
          return res.status(429).json({
            success: false,
            error: 'Too many incorrect attempts. Locked for 15 minutes.',
            locked: true,
          });
        }

        return res.status(200).json({
          success: false,
          error: `Incorrect PIN. ${5 - attempts} attempt${5 - attempts === 1 ? '' : 's'} remaining.`,
        });
      }

      // Correct PIN — clear fail cookie, set session
      res.setHeader('Set-Cookie', [
        `${failKey}=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
      ]);
      setSessionCookie(res, id, study || 'default');
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setSessionCookie(res, subjectId, studySlug) {
  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toUTCString();
  res.setHeader('Set-Cookie', [
    `active_study=${encodeURIComponent(studySlug)}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires}`,
  ]);
}

function parseCookies(cookieStr) {
  const cookies = {};
  cookieStr.split(';').forEach(part => {
    const [k, ...rest] = part.trim().split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(rest.join('=').trim());
  });
  return cookies;
}

function parseFailData(raw) {
  if (!raw) return { attempts: 0, locked: false, until: 0 };
  try {
    const d = JSON.parse(raw);
    if (d.locked && d.until > Date.now()) return d;       // still locked
    if (d.locked && d.until <= Date.now()) return { attempts: 0, locked: false, until: 0 }; // lockout expired
    return d;
  } catch {
    return { attempts: 0, locked: false, until: 0 };
  }
}
