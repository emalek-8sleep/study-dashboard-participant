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

const EXTRACTION_PROMPT = `
Analyze the study documentation provided and extract information to populate a study management spreadsheet.

Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:

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

Guidelines:
- phases: identify all distinct study periods mentioned (baseline, run-in, washout, intervention, extension, follow-up, etc.). Estimate duration in days from the protocol.
- checkinFields: identify daily or nightly participant measurements (sleep quality ratings, device usage confirmation, symptom scores, survey responses, etc.). Each field maps to one spreadsheet column.
- columnName must be clean Title Case with no special characters (e.g. "Sleep Quality Score" not "sleep_quality_score").
- setupSteps: extract device setup or study enrollment steps if described. Return an empty array if none are mentioned.
- If information is ambiguous or missing, make a reasonable inference based on context. Use empty string for truly unknown values.
- Return ONLY the JSON object. No other text before or after it.
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured in environment variables.' });
  }

  const { text, pdfBase64, docxBase64, googleDocsUrl } = req.body;

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Build the message content array
    const contentBlocks = [];

    // 1. PDF — extract text via pdf-parse and send as a text block
    // (Using text extraction is more reliable than the document/base64 approach
    //  which can fail with certain SDK versions and payload sizes)
    if (pdfBase64) {
      try {
        // Use the direct lib path to avoid pdf-parse's test-file auto-load in serverless
        const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
        const buffer   = Buffer.from(sanitizeBase64(pdfBase64), 'base64');
        const { text } = await pdfParse(buffer);
        if (text.trim()) {
          contentBlocks.push({ type: 'text', text: `[PDF Content]\n\n${text.trim()}` });
        }
      } catch (pdfErr) {
        console.error('[extract-study] PDF parse error:', pdfErr.message);
        // Non-fatal — other content blocks (text paste, docx, etc.) can still be used
      }
    }

    // 2. DOCX — extract raw text via mammoth
    if (docxBase64) {
      const mammoth = await import('mammoth');
      const buffer  = Buffer.from(docxBase64, 'base64');
      const { value: docxText } = await mammoth.default.extractRawText({ buffer });
      if (docxText.trim()) {
        contentBlocks.push({ type: 'text', text: `[Word Document Content]\n\n${docxText}` });
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

    // Add extraction prompt as final message
    contentBlocks.push({ type: 'text', text: EXTRACTION_PROMPT });

    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: contentBlocks }],
    });

    // Parse JSON from response — Claude should return only raw JSON per prompt
    const raw  = (response.content[0]?.text || '').trim();
    const json = parseJsonSafely(raw);

    if (!json) {
      return res.status(500).json({ error: 'Could not parse structured data from Claude response.', raw });
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
  // Remove data URL prefix if the caller accidentally included it
  const raw = str.includes(',') ? str.split(',').pop() : str;
  // Strip all whitespace (newlines, spaces, tabs)
  const clean = raw.replace(/\s/g, '');
  // Re-pad to a valid multiple of 4
  return clean + '='.repeat((4 - (clean.length % 4)) % 4);
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
