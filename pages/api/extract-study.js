/**
 * POST /api/extract-study
 *
 * Accepts study documents in any combination of:
 *   - text:         plain text pasted by the coordinator
 *   - pdfBase64:    base64-encoded PDF (sent as native Claude document block)
 *   - docxBase64:   base64-encoded .docx (extracted via mammoth server-side)
 *   - googleDocsUrl: a public Google Docs share URL
 *
 * Calls the Anthropic API and returns a structured JSON object that
 * the onboarding wizard uses to pre-fill the review form.
 */

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

// System prompt — Claude follows format constraints much more reliably
// when they are in the system role rather than appended to user content.
const SYSTEM_PROMPT = `You are a clinical research data extractor. Your sole job is to read study documents and return a single, raw JSON object — no markdown fences, no explanation, no preamble, nothing else whatsoever. If you output anything other than the JSON object the response will be unusable.

Extract information to populate a study management spreadsheet. Return ONLY this JSON structure:

{
  "studyName": "full name of the study",
  "contactEmail": "coordinator or PI email if found, else empty string",
  "phases": [
    {
      "phaseNumber": 1,
      "phaseName": "e.g. Baseline, Washout, Intervention, Follow-Up",
      "durationDays": 7,
      "description": "what participants do during this phase",
      "goal": "what is being measured or achieved"
    }
  ],
  "checkinFields": [
    {
      "fieldLabel": "Human-readable label shown on the dashboard",
      "columnName": "Spreadsheet column name (Title Case, no special chars)",
      "invalidTips": "Describe what an invalid/concerning response looks like"
    }
  ],
  "setupSteps": [
    {
      "stepNumber": 1,
      "stepTitle": "Short title for this step",
      "description": "Detailed instructions for the participant",
      "tips": "Optional tip 1 | Optional tip 2"
    }
  ]
}

Rules:
- phases: all distinct study periods (baseline, run-in, washout, intervention, extension, follow-up, etc.). Estimate durationDays from the protocol.
- checkinFields: daily/nightly participant measurements (sleep quality, device usage, symptom scores, survey responses). Each field = one spreadsheet column.
- columnName: clean Title Case, no special characters (e.g. "Sleep Quality Score").
- setupSteps: device setup or enrollment steps. Empty array if none mentioned.
- Use empty string for unknown values. Make reasonable inferences for ambiguous info.
- YOUR ENTIRE RESPONSE MUST BE THE JSON OBJECT AND NOTHING ELSE.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured in environment variables.' });
  }

  const { text, pdfFiles, docxFiles, googleDocsUrl } = req.body;

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Build the message content array
    const contentBlocks = [];

    // 1. PDFs — send as native Anthropic document blocks (one per file)
    if (Array.isArray(pdfFiles) && pdfFiles.length > 0) {
      for (const raw of pdfFiles) {
        const data = sanitizeBase64(raw);
        if (data) {
          contentBlocks.push({
            type:   'document',
            source: { type: 'base64', media_type: 'application/pdf', data },
          });
        }
      }
    }

    // 2. DOCX — extract raw text via mammoth
    if (Array.isArray(docxFiles) && docxFiles.length > 0) {
      const mammoth = await import('mammoth');
      for (const raw of docxFiles) {
        const buffer = Buffer.from(raw, 'base64');
        const { value: docxText } = await mammoth.default.extractRawText({ buffer });
        if (docxText.trim()) {
          contentBlocks.push({ type: 'text', text: `[Word Document Content]\n\n${docxText}` });
        }
      }
    }

    // 3. Google Docs URL — fetch as plain text export
    if (googleDocsUrl) {
      const docId = extractGoogleDocId(googleDocsUrl);
      if (docId) {
        const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
        const gdRes     = await fetch(exportUrl);
        if (gdRes.ok) {
          const gdText = await gdRes.text();
          if (gdText.trim()) {
            contentBlocks.push({ type: 'text', text: `[Google Doc Content]\n\n${gdText}` });
          }
        }
      }
    }

    // 4. Pasted plain text
    if (text && text.trim()) {
      contentBlocks.push({ type: 'text', text: `[Study Documents]\n\n${text.trim()}` });
    }

    if (contentBlocks.length === 0) {
      return res.status(400).json({ error: 'No document content provided.' });
    }

    // Add a brief user instruction (the detailed rules are in the system prompt)
    contentBlocks.push({
      type: 'text',
      text: 'Extract the study information from the document(s) above and return the JSON object.',
    });

    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: contentBlocks }],
    });

    // Parse JSON from response
    const raw  = (response.content[0]?.text || '').trim();
    console.log('[extract-study] raw response (first 500 chars):', raw.slice(0, 500));
    const json = parseJsonSafely(raw);

    if (!json) {
      console.error('[extract-study] failed to parse JSON. Full response:', raw);
      return res.status(500).json({
        error: 'Could not parse structured data from Claude response.',
        hint:  raw.slice(0, 300),
      });
    }

    return res.status(200).json(json);

  } catch (err) {
    console.error('[extract-study] error:', err);
    return res.status(500).json({ error: err.message || 'Extraction failed.' });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip whitespace and any accidental data-URL prefix from a base64 string,
 * then re-pad to a valid multiple of 4. Browsers occasionally include
 * line breaks or the full "data:...;base64," prefix in FileReader output.
 */
function sanitizeBase64(str) {
  if (!str) return '';
  // Strip data URL prefix (e.g. "data:application/pdf;base64,")
  const raw = str.includes(',') ? str.split(',').pop() : str;
  // Strip all whitespace, then strip any existing padding before re-padding
  // (double-padding is invalid — must remove first)
  const stripped = raw.replace(/\s/g, '').replace(/=+$/, '');
  return stripped + '='.repeat((4 - (stripped.length % 4)) % 4);
}

function extractGoogleDocId(url) {
  // Matches /document/d/{ID}/ or /document/d/{ID}?
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function parseJsonSafely(text) {
  // Try direct parse first
  try { return JSON.parse(text); } catch {}
  // Try extracting JSON from a code block
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch {}
  }
  // Try finding the outermost {...}
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }
  return null;
}
