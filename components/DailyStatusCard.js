/**
 * DailyStatusCard
 *
 * Shows last night's check-in status as a "Prepare for Tonight" checklist.
 * Invalid fields appear as unchecked items — participants check them off after
 * reviewing the troubleshooting steps. Acknowledgments save to the Daily Status
 * row in Google Sheets so coordinators can see what was reviewed.
 *
 * Valid fields show as already checked. When all invalid items are acknowledged,
 * a "You're ready for tonight!" banner is shown.
 *
 * Also shows a collapsible history of all previous nights.
 */

import { useState } from 'react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValid(val) {
  const v = (val || '').toString().toLowerCase().trim();
  return v === 'yes' || v === 'true' || v === 'complete' || v === 'valid' || v === 'pass';
}

function isInvalid(val) {
  const v = (val || '').toString().toLowerCase().trim();
  return v === 'no' || v === 'false' || v === 'incomplete' || v === 'invalid' || v === 'fail';
}

function formatDate(dateStr, short = false) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', short
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : { weekday: 'long', month: 'long', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function parseTips(raw) {
  if (!raw) return [];
  const t = raw.trim();
  if (t.includes(' | ')) return t.split(' | ').map(s => s.trim()).filter(Boolean);
  if (t.includes('\n'))  return t.split('\n').map(s => s.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean);
  if (t.includes('; '))  return t.split('; ').map(s => s.trim()).filter(Boolean);
  return t ? [t] : [];
}

// ─── Checkbox icon ────────────────────────────────────────────────────────────

function Checkbox({ checked, pending, className = '' }) {
  if (checked) {
    return (
      <div className={`w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 ${className}`}>
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  return (
    <div className={`w-5 h-5 rounded-full border-2 border-slate-300 flex items-center justify-center shrink-0 ${pending ? 'opacity-50' : ''} ${className}`}>
      {pending && <div className="w-2 h-2 rounded-full bg-slate-300 animate-pulse" />}
    </div>
  );
}

// ─── Single field row (checklist style) ──────────────────────────────────────

/**
 * @param {object}   field        - Check-in field config row from Sheet
 * @param {object}   row          - Daily Status row data
 * @param {string}   actionUrl    - Pre-built action URL (or empty string)
 * @param {boolean}  isAcked      - Whether this field is acknowledged
 * @param {boolean}  ackPending   - Whether an ack save is in-flight
 * @param {function} onToggleAck  - Called with (colName, dateStr, add: boolean)
 * @param {string}   dateStr      - YYYY-MM-DD date for today's row
 */
function FieldRow({ field, row, actionUrl, isAcked = false, ackPending = false, onToggleAck, dateStr = '' }) {
  const [tipsOpen, setTipsOpen] = useState(false);

  const colName     = field['Column Name'] || '';
  const label       = field['Field Label'] || colName;
  const rawVal      = row ? (row[colName] || '') : '';
  const valid       = isValid(rawVal);
  const invalid     = isInvalid(rawVal);
  const unknown     = !valid && !invalid;
  const tips        = parseTips(field['Invalid Tips'] || '');
  const actionLabel = (field['Action Label'] || '').trim();
  const canAck      = invalid && !!onToggleAck && !!dateStr;
  const resolved    = valid || isAcked;   // green checkbox if valid OR acknowledged

  // Valid → green; acknowledged-invalid → muted; unreviewed-invalid → red; unknown → gray
  const bg = valid    ? 'bg-emerald-50 border border-emerald-100'
           : isAcked  ? 'bg-slate-50 border border-slate-100'
           : invalid  ? 'bg-red-50 border border-red-100'
           :            'bg-slate-50 border border-slate-100';

  return (
    <div className={`rounded-xl px-4 py-3 ${bg}`}>
      {/* ── Row header ── */}
      <div className="flex items-center gap-3">
        {/* Checkbox — clickable when invalid */}
        {canAck ? (
          <button
            onClick={() => onToggleAck(colName, dateStr, !isAcked)}
            disabled={ackPending}
            aria-label={isAcked ? 'Mark as unreviewed' : 'Mark as reviewed'}
            className="shrink-0 transition hover:scale-110 disabled:opacity-50"
          >
            <Checkbox checked={isAcked} pending={ackPending} />
          </button>
        ) : (
          <Checkbox checked={resolved} pending={false} />
        )}

        {/* Label */}
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-medium ${resolved ? 'text-slate-500' : invalid ? 'text-slate-800' : 'text-slate-500'}`}>
            {invalid && !isAcked
              ? `Review ${label} steps`
              : label}
          </span>
        </div>

        {/* Status badge */}
        <span className={`text-xs font-semibold shrink-0 ${
          valid    ? 'text-emerald-600' :
          isAcked  ? 'text-slate-400' :
          invalid  ? 'text-red-500' :
                     'text-slate-400'
        }`}>
          {valid ? 'Valid' : isAcked ? 'Reviewed ✓' : invalid ? 'Needs attention' : 'Not recorded'}
        </span>
      </div>

      {/* ── Expandable detail for invalid items ── */}
      {invalid && (
        <div className="mt-2 ml-8 space-y-2">
          {actionUrl && actionLabel && (
            <a
              href={actionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {actionLabel}
            </a>
          )}

          {tips.length > 0 && (
            <div>
              <button
                onClick={() => setTipsOpen(!tipsOpen)}
                className={`text-xs font-semibold underline underline-offset-2 transition ${isAcked ? 'text-slate-400 hover:text-slate-600' : 'text-red-500 hover:text-red-600'}`}
              >
                {tipsOpen ? 'Hide tips ↑' : 'See troubleshooting tips ↓'}
              </button>
              {tipsOpen && (
                <ol className="mt-2 space-y-1.5">
                  {tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                      <span className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5 ${isAcked ? 'bg-slate-100 text-slate-400' : 'bg-red-100 text-red-500'}`}>
                        {i + 1}
                      </span>
                      {tip}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {tips.length === 0 && !actionUrl && (
            <p className="text-xs text-slate-500">Contact your study coordinator if you need help.</p>
          )}

          {/* Ack confirm text when checked */}
          {canAck && isAcked && (
            <p className="text-xs text-slate-400">
              Marked as reviewed —{' '}
              <button
                onClick={() => onToggleAck(colName, dateStr, false)}
                disabled={ackPending}
                className="underline underline-offset-2 hover:text-slate-600 transition"
              >
                undo
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── History row ──────────────────────────────────────────────────────────────

function HistoryRow({ row, checkinFields, config, isBreakNight = false }) {
  const [open, setOpen] = useState(false);

  // Break night — simplified display, no status dots
  if (isBreakNight) {
    return (
      <div className="border border-slate-100 rounded-xl bg-slate-50/60">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="text-xs font-medium text-slate-400 w-24 sm:w-36 shrink-0 truncate">
            {formatDate(row['Date'], true)}
          </span>
          <div className="flex items-center gap-1.5 flex-1">
            <svg className="w-3.5 h-3.5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            <span className="text-xs text-slate-400 italic">Break night</span>
          </div>
        </div>
      </div>
    );
  }

  const invalidCount = checkinFields.filter(f => isInvalid(row[f['Column Name']] || '')).length;
  const validCount   = checkinFields.filter(f => isValid(row[f['Column Name']] || '')).length;
  const allGood      = invalidCount === 0 && validCount === checkinFields.length;

  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition"
      >
        <span className="text-xs font-medium text-slate-500 w-24 sm:w-36 shrink-0 truncate">
          {formatDate(row['Date'], true)}
        </span>

        <div className="flex items-center gap-1 flex-1">
          {checkinFields.map((f, i) => {
            const val = row[f['Column Name']] || '';
            return (
              <div
                key={i}
                title={`${f['Field Label']}: ${isValid(val) ? 'Valid' : isInvalid(val) ? 'Invalid' : 'Not recorded'}`}
                className={`w-2.5 h-2.5 rounded-full ${isValid(val) ? 'bg-emerald-400' : isInvalid(val) ? 'bg-red-400' : 'bg-slate-200'}`}
              />
            );
          })}
        </div>

        <span className={`text-xs font-semibold shrink-0 ${
          allGood ? 'text-emerald-600' : invalidCount > 0 ? 'text-red-500' : 'text-slate-400'
        }`}>
          {allGood ? 'All valid' : invalidCount > 0 ? `${invalidCount} issue${invalidCount > 1 ? 's' : ''}` : 'Incomplete'}
        </span>

        <svg className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-100 bg-slate-50 space-y-2 pt-3">
          {checkinFields.map((field, i) => {
            const urlKey    = (field['Action URL Key'] || '').toLowerCase().replace(/\s+/g, '_');
            const actionUrl = urlKey ? (config[urlKey] || '') : '';
            return <FieldRow key={i} field={field} row={row} actionUrl={actionUrl} />;
          })}
          {row['Notes'] && (
            <div className="px-4 py-3 bg-amber-50 rounded-xl border border-amber-100">
              <p className="text-xs font-semibold text-amber-700 mb-1">Coordinator note</p>
              <p className="text-sm text-slate-700">{row['Notes']}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * @param {string[]} initialAcknowledgments - Array of "colName_YYYY-MM-DD" strings from the Sheet
 * @param {string}   subjectId              - Participant's Subject ID (for the ack API call)
 * @param {string}   studySlug              - Active study slug (for the ack API call)
 */
export default function DailyStatusCard({
  todayStatus,
  history,
  checkinFields,
  config,
  hstUploadLink,
  showFullHistory = false,
  breakNights = [],
  initialAcknowledgments = [],
  subjectId = '',
  studySlug = '',
}) {
  const [showHistory, setShowHistory] = useState(showFullHistory);

  // ── Acknowledgment state — synced to Google Sheets ───────────────────────
  // Keyed by colName only — stored on the Daily Status row for today,
  // so the date is implicit (no colName_date compound keys needed)
  const [acks,       setAcks]       = useState(() => new Set(initialAcknowledgments));
  const [ackPending, setAckPending] = useState(new Set()); // in-flight field names

  const todayDateStr = todayStatus
    ? (todayStatus['Date'] || '').toString().trim().split('T')[0]
    : '';

  async function handleToggleAck(colName, dateStr, add) {
    // Optimistic update — key is just the column name
    const nextAcks = new Set(acks);
    if (add) nextAcks.add(colName); else nextAcks.delete(colName);
    setAcks(nextAcks);

    // Mark as pending
    setAckPending(prev => new Set([...prev, colName]));

    try {
      const res = await fetch('/api/acknowledge', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          id:        subjectId,
          study:     studySlug,
          fieldName: colName,
          dateStr,
          action:    add ? 'add' : 'remove',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('[ack] save failed:', err.message);
      // Rollback on error
      setAcks(acks);
    } finally {
      setAckPending(prev => {
        const next = new Set(prev);
        next.delete(colName);
        return next;
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  const hasToday   = !!todayStatus;
  const pastDays   = (history || []).filter(r => r !== todayStatus);

  // Fields that were invalid last night
  const invalidFields = hasToday
    ? checkinFields.filter(f => isInvalid(todayStatus[f['Column Name']] || ''))
    : [];
  const actionCount = invalidFields.length;

  // All-clear: no invalid fields, OR all invalid fields acknowledged
  const allValid    = hasToday && actionCount === 0 && checkinFields.some(f => isValid(todayStatus[f['Column Name']] || ''));
  const allReviewed = hasToday && actionCount > 0 && invalidFields.every(f => acks.has(f['Column Name'] || ''));
  const readyForTonight = allValid || allReviewed;

  return (
    <div className="card border-slate-100">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="section-title mb-0">Last Night's Check-In</h3>
            {hasToday && (
              <span className="text-sm font-semibold text-slate-500">
                {formatDate(todayStatus['Date'], true)}
              </span>
            )}
          </div>
          {!hasToday && (
            <p className="text-xs text-slate-400 mt-0.5">No data recorded yet</p>
          )}
        </div>
        {hasToday && actionCount > 0 && !allReviewed && (
          <span className="badge bg-amber-100 text-amber-700 shrink-0">
            {actionCount - [...acks].filter(k => invalidFields.some(f => f['Column Name'] === k)).length} of {actionCount} to review
          </span>
        )}
        {readyForTonight && <span className="badge badge-complete shrink-0">Ready for tonight ✓</span>}
      </div>

      {/* Ready-for-tonight banner */}
      {readyForTonight && hasToday && (
        <div className="mb-4 flex items-center gap-3 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
          <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-emerald-800">
            {allValid ? "All good — you're ready for tonight!" : "You've reviewed everything — you're ready for tonight!"}
          </p>
        </div>
      )}

      {/* Today's fields */}
      {hasToday ? (
        <div className="space-y-2">
          {checkinFields.length > 0 ? (
            checkinFields.map((field, i) => {
              const urlKey    = (field['Action URL Key'] || '').toLowerCase().replace(/\s+/g, '_');
              const actionUrl = urlKey ? (config[urlKey] || '') : '';
              const colName   = field['Column Name'] || '';
              return (
                <FieldRow
                  key={i}
                  field={field}
                  row={todayStatus}
                  actionUrl={actionUrl}
                  isAcked={acks.has(colName)}
                  ackPending={ackPending.has(colName)}
                  onToggleAck={subjectId ? handleToggleAck : null}
                  dateStr={todayDateStr}
                />
              );
            })
          ) : (
            <p className="text-sm text-slate-400 text-center py-4">
              No check-in fields configured — add rows to the <strong>Check-in Fields</strong> tab in your sheet.
            </p>
          )}

          {todayStatus['Notes'] && (
            <div className="px-4 py-3 bg-amber-50 rounded-xl border border-amber-100">
              <p className="text-xs font-semibold text-amber-700 mb-1">Note from your study coordinator</p>
              <p className="text-sm text-slate-700">{todayStatus['Notes']}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-6 text-slate-400">
          <svg className="w-10 h-10 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          <p className="text-sm">No check-in data yet.</p>
          <p className="text-xs mt-1">Your coordinator will update this each morning.</p>
        </div>
      )}

      {/* HST Upload */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800">Upload HST Files</p>
            <p className="text-xs text-slate-500 mt-0.5 mb-2">
              Plug your HST device into your computer each morning and upload the files here before 10am.
            </p>
            {hstUploadLink ? (
              <a href={hstUploadLink} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload Today's HST Files
              </a>
            ) : (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 inline-block">
                Upload link not configured — add <code className="font-mono">hst_upload_link</code> to Study Config.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Previous nights */}
      {pastDays.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          {!showFullHistory && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-800 transition w-full"
            >
              <svg className={`w-4 h-4 transition-transform ${showHistory ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Previous Nights ({pastDays.length})
            </button>
          )}

          {(showHistory || showFullHistory) && (
            <div className={`space-y-2 ${!showFullHistory ? 'mt-3' : ''}`}>
              {showFullHistory && (
                <p className="text-xs font-semibold text-slate-500 mb-2">Previous Nights ({pastDays.length})</p>
              )}
              {pastDays.map((row, i) => {
                const dateStr      = (row['Date'] || '').trim().split('T')[0];
                const isBreakNight = breakNights.includes(dateStr);
                return (
                  <HistoryRow
                    key={i}
                    row={row}
                    checkinFields={checkinFields}
                    config={config}
                    isBreakNight={isBreakNight}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
