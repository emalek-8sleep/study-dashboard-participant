/**
 * POST /api/generate-sheet
 *
 * Receives the coordinator-reviewed study structure and returns
 * a .xlsx file pre-populated with all tabs the dashboard expects.
 *
 * Tabs generated:
 *   Study Config | Participants | Phases | Daily Status | Check-in Fields
 *   Comments | Docs | Troubleshooting | Setup Steps | Shipments
 */

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    studyName,
    studyShortName,
    studyDescription,
    contactEmail,
    principalInvestigator,
    phases,
    checkinFields,
    setupSteps,
    importantInfo,
    participantInfo,
    hstIntegration,
    verificationRequired,
    verificationFieldColumn,
  } = req.body;

  try {
    const XLSX = await import('xlsx');

    const wb = XLSX.utils.book_new();

    // ── 1. Study Config ───────────────────────────────────────────────────────
    const configRows = [
      ['Key', 'Value'],
      ['study_name',             studyName             || ''],
      ['study_short_name',       studyShortName        || ''],
      ['study_description',      studyDescription      || ''],
      ['contact_email',          contactEmail          || ''],
      ['principal_investigator', principalInvestigator || ''],
      ['hst_upload_link',        hstIntegration?.enabled ? '' : ''],
      ['hst_upload_column',      hstIntegration?.uploadLinkColumn || ''],
      ['verification_required',  verificationRequired ? 'true' : 'false'],
      ['verification_field',     verificationFieldColumn || ''],
      ['important_info_title',   importantInfo?.title   || ''],
      ['important_info_content', importantInfo?.content || ''],
      ['participant_info_title', participantInfo?.title || ''],
      ['participant_info_content', participantInfo?.content || ''],
      ['admin_code',             ''],  // will be overridden by ADMIN_CODE env var
      ['comments_script_url',    ''],
    ];
    addSheet(XLSX, wb, 'Study Config', configRows, {
      colWidths: [30, 70],
      headerStyle: true,
    });

    // ── 2. Build phase-day columns for Participants + Phases ──────────────────
    // Each (phase, day) pair becomes one column in Participants, keyed by "Status Column"
    const phaseDayCols = [];
    (phases || []).forEach((ph) => {
      const days = Math.max(1, Number(ph.durationDays) || 7);
      for (let d = 1; d <= days; d++) {
        phaseDayCols.push({
          phaseNumber: ph.phaseNumber,
          phaseName:   ph.phaseName,
          dayNumber:   d,
          dayLabel:    `Day ${d}`,
          description: ph.description || '',
          goal:        ph.goal        || '',
          statusCol:   `${ph.phaseName} Day ${d}`,
        });
      }
    });

    // ── 3. Participants ───────────────────────────────────────────────────────
    const participantHeaders = [
      'Subject ID', 'First Name', 'Last Name', 'Email', 'Phone', 'Status',
      ...phaseDayCols.map((p) => p.statusCol),
    ];
    const participantExamples = [
      ['SBJ-001', 'Jane',  'Smith',  '', '', 'Active', ...phaseDayCols.map(() => 'Pending')],
      ['SBJ-002', 'John',  'Doe',    '', '', 'Active', ...phaseDayCols.map(() => 'Pending')],
      ['SBJ-003', 'Maria', 'Garcia', '', '', 'Active', ...phaseDayCols.map(() => 'Pending')],
    ];
    addSheet(XLSX, wb, 'Participants', [participantHeaders, ...participantExamples], {
      colWidths: participantHeaders.map((h) => Math.max(h.length + 2, 12)),
      headerStyle: true,
      freezeFirstRow: true,
    });

    // ── 4. Phases ─────────────────────────────────────────────────────────────
    const phasesHeader = [
      'Phase Number', 'Phase Name', 'Day Number', 'Day Label',
      'Description', 'Goal', 'Condition', 'Status Column',
    ];
    const phasesRows = phaseDayCols.map((p) => [
      p.phaseNumber, p.phaseName, p.dayNumber, p.dayLabel,
      p.description, p.goal, p.condition || '', p.statusCol,
    ]);
    addSheet(XLSX, wb, 'Phases', [phasesHeader, ...phasesRows], {
      colWidths: [14, 20, 12, 12, 40, 40, 20, 30],
      headerStyle: true,
    });

    // ── 5. Daily Status ───────────────────────────────────────────────────────
    const checkinColNames  = (checkinFields || []).map((f) => f.columnName || f.fieldLabel);
    const dailyStatusHeader = ['Subject ID', 'Date', ...checkinColNames];
    addSheet(XLSX, wb, 'Daily Status', [dailyStatusHeader], {
      colWidths: dailyStatusHeader.map(() => 20),
      headerStyle: true,
      note: 'This tab is populated by your nightly check-in form or data pipeline.',
    });

    // ── 6. Check-in Fields ────────────────────────────────────────────────────
    const checkinFieldsHeader = [
      'Field Label', 'Column Name', 'Invalid Tips', 'Action Label', 'Action URL Key',
    ];
    const checkinFieldsRows = (checkinFields || []).map((f) => [
      f.fieldLabel  || '',
      f.columnName  || f.fieldLabel || '',
      f.invalidTips || '',
      f.actionLabel || '',
      f.actionUrl   || '',
    ]);
    addSheet(XLSX, wb, 'Check-in Fields', [checkinFieldsHeader, ...checkinFieldsRows], {
      colWidths: [25, 25, 45, 20, 25],
      headerStyle: true,
    });

    // ── 7. Comments ───────────────────────────────────────────────────────────
    addSheet(XLSX, wb, 'Comments', [
      ['Subject ID', 'Submitted At', 'Comment', 'Coordinator Response', 'Resolved'],
    ], { colWidths: [15, 20, 60, 60, 12], headerStyle: true });

    // ── 8. Docs ───────────────────────────────────────────────────────────────
    addSheet(XLSX, wb, 'Docs', [
      ['Title', 'Description', 'URL', 'Category', 'Icon'],
      ['Study Protocol', 'Full study protocol document', '', 'Protocol', ''],
      ['Informed Consent', 'Participant consent form', '', 'Documents', ''],
    ], { colWidths: [30, 50, 60, 20, 10], headerStyle: true });

    // ── 9. Troubleshooting ────────────────────────────────────────────────────
    addSheet(XLSX, wb, 'Troubleshooting', [
      ['Device', 'Issue Title', 'Steps', 'Link'],
    ], { colWidths: [20, 35, 80, 40], headerStyle: true });

    // ── 10. Setup Steps ───────────────────────────────────────────────────────
    const setupHeader = ['Step Number', 'Step Title', 'Description', 'Image URL', 'Tips'];
    const setupRows   = (setupSteps || []).map((s) => [
      s.stepNumber || '',
      s.stepTitle  || '',
      s.description || '',
      '',
      s.tips || '',
    ]);
    addSheet(XLSX, wb, 'Setup Steps', [setupHeader, ...setupRows], {
      colWidths: [13, 30, 60, 40, 60],
      headerStyle: true,
    });

    // ── 11. Shipments ─────────────────────────────────────────────────────────
    addSheet(XLSX, wb, 'Shipments', [
      ['Subject ID', 'Package Name', 'Tracking URL', 'Tracking Status'],
    ], { colWidths: [15, 25, 60, 20], headerStyle: true });

    // ── Write & return ────────────────────────────────────────────────────────
    const buf      = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `${slugify(studyName || 'study')}-template.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);

  } catch (err) {
    console.error('[generate-sheet] error:', err);
    return res.status(500).json({ error: err.message || 'Sheet generation failed.' });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Appends a worksheet to the workbook with optional column widths and
 * a styled header row (bold + light gray background).
 */
function addSheet(XLSX, wb, sheetName, rows, opts = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  if (opts.colWidths) {
    ws['!cols'] = opts.colWidths.map((w) => ({ wch: w }));
  }

  // Freeze the first row
  if (opts.freezeFirstRow) {
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  }

  // Style the header row (bold text + light background)
  if (opts.headerStyle && rows.length > 0) {
    const numCols = rows[0].length;
    for (let c = 0; c < numCols; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r: 0, c });
      if (!ws[cellAddr]) continue;
      ws[cellAddr].s = {
        font:      { bold: true, color: { rgb: '1e293b' } },
        fill:      { fgColor: { rgb: 'e2e8f0' } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: {
          bottom: { style: 'thin', color: { rgb: 'cbd5e1' } },
        },
      };
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}
