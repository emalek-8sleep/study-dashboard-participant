/**
 * DailyStatusCard
 *
 * Shows the participant's most recent night's check-in status,
 * with dynamic fields driven by the "Check-in Fields" Google Sheet tab.
 *
 * Each field can have:
 *  - Inline troubleshooting tips (from the sheet)
 *  - An action button with a configurable URL (e.g. survey link)
 *  - A "needs attention" / "valid" / "not recorded" state
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

// ─── Single field row ─────────────────────────────────────────────────────────

function FieldRow({ field, row, actionUrl }) {
  const [tipsOpen, setTipsOpen] = useState(false);

  const colName    = field['Column Name'] || '';
  const label      = field['Field Label'] || colName;
  const rawVal     = row ? (row[colName] || '') : '';
  const valid      = isValid(rawVal);
  const invalid    = isInvalid(rawVal);
  const unknown    = !valid && !invalid;

  const tips        = parseTips(field['Invalid Tips'] || '');
  const actionLabel = (field['Action Label'] || '').trim();

  const bg    = unknown ? 'bg-slate-50'      : valid ? 'bg-emerald-50'    : 'bg-red-50';
  const icon  = unknown ? '–'                : valid ? '✓'                : '✗';
  const color = unknown ? 'text-slate-400'   : valid ? 'text-emerald-600' : 'text-red-500';
  const statusLabel = unknown ? 'Not recorded' : valid ? 'Valid' : 'Needs attention';

  return (
    <div className={`rounded-xl px-4 py-3 ${bg}`}>
      <div className="flex items-center gap-3">
        <span className={`text-sm font-bold w-4 text-center shrink-0 ${color}`}>{icon}</span>
        <span className="text-sm font-medium text-slate-700 flex-1">{label}</span>
        <span className={`text-xs font-semibold ${color}`}>{statusLabel}</span>
      </div>

      {invalid && (
        <div className="mt-2 ml-7 space-y-2">
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
                className="text-xs font-semibold text-red-500 hover:text-red-600 underline underline-offset-2 transition"
              >
                {tipsOpen ? 'Hide tips ↑' : 'See troubleshooting tips ↓'}
              </button>
              {tipsOpen && (
                <ol className="mt-2 space-y-1.5">
                  {tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                      <span className="w-4 h-4 rounded-full bg-red-100 text-red-500 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
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
        </div>
      )}
    </div>
  );
}

// ─── History row ──────────────────────────────────────────────────────────────

function HistoryRow({ row, checkinFields, config }) {
  const [open, setOpen] = useState(false);

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

export default function DailyStatusCard({ todayStatus, history, checkinFields, config, hstUploadLink }) {
  const [showHistory, setShowHistory] = useState(false);

  const hasToday   = !!todayStatus;
  const pastDays   = (history || []).filter(r => r !== todayStatus);

  const actionCount = hasToday
    ? checkinFields.filter(f => isInvalid(todayStatus[f['Column Name']] || '')).length
    : 0;

  const allGood = hasToday && actionCount === 0 &&
    checkinFields.some(f => isValid(todayStatus[f['Column Name']] || ''));

  return (
    <div className="card border-slate-100">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="section-title mb-0">Last Night's Check-In</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {hasToday ? `Data for ${formatDate(todayStatus['Date'])}` : 'No data recorded yet for today'}
          </p>
        </div>
        {hasToday && actionCount > 0 && (
          <span className="badge bg-amber-100 text-amber-700 shrink-0">
            {actionCount} item{actionCount > 1 ? 's' : ''} need attention
          </span>
        )}
        {allGood && <span className="badge badge-complete shrink-0">All good!</span>}
      </div>

      {/* Today's fields */}
      {hasToday ? (
        <div className="space-y-2">
          {checkinFields.length > 0 ? (
            checkinFields.map((field, i) => {
              const urlKey    = (field['Action URL Key'] || '').toLowerCase().replace(/\s+/g, '_');
              const actionUrl = urlKey ? (config[urlKey] || '') : '';
              return <FieldRow key={i} field={field} row={todayStatus} actionUrl={actionUrl} />;
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

          {showHistory && (
            <div className="mt-3 space-y-2">
              {pastDays.map((row, i) => (
                <HistoryRow key={i} row={row} checkinFields={checkinFields} config={config} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
