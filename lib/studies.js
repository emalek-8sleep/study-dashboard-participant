/**
 * studies.js — Multi-study support
 *
 * Set the STUDIES env var in Vercel with comma-separated "Name:SheetId" pairs:
 *   STUDIES=Full Moon:1abc123,Orbit:1xyz456,Wesper:1Kbl...
 *
 * Falls back to NEXT_PUBLIC_SHEET_ID if STUDIES is not set (single-study mode).
 * In single-study mode, everything works exactly as before — no changes needed.
 */

export function getStudies() {
  const raw = (process.env.STUDIES || '').trim();
  const studies = [];

  if (raw) {
    raw.split(',').forEach((entry) => {
      // Split on the FIRST colon only, so Sheet IDs (which contain no colons) are safe
      const colonIdx = entry.indexOf(':');
      if (colonIdx > 0) {
        const name    = entry.substring(0, colonIdx).trim();
        const sheetId = entry.substring(colonIdx + 1).trim();
        if (name && sheetId) {
          studies.push({ name, sheetId, slug: nameToSlug(name) });
        }
      }
    });
  }

  // Fallback: single-study mode using the legacy NEXT_PUBLIC_SHEET_ID env var
  if (studies.length === 0) {
    const fallbackId = process.env.NEXT_PUBLIC_SHEET_ID || '';
    if (fallbackId) {
      studies.push({ name: 'My Study', sheetId: fallbackId, slug: 'default' });
    }
  }

  return studies;
}

/**
 * Given a study slug (e.g. "full-moon"), returns the corresponding Sheet ID.
 * Falls back to the first/default study if the slug isn't found.
 */
export function getSheetIdBySlug(slug) {
  if (!slug) return getDefaultSheetId();
  const studies = getStudies();
  const study   = studies.find((s) => s.slug === slug);
  return study ? study.sheetId : getDefaultSheetId();
}

/**
 * Returns the Sheet ID for the first configured study (the default).
 */
export function getDefaultSheetId() {
  const studies = getStudies();
  return studies.length > 0 ? studies[0].sheetId : (process.env.NEXT_PUBLIC_SHEET_ID || '');
}

/**
 * Converts a study name to a URL-safe slug.
 * e.g. "Full Moon" → "full-moon", "Orbit Study!" → "orbit-study"
 */
export function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}
