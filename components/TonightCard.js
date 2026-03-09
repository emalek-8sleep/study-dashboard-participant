/**
 * TonightCard
 *
 * Shows the participant what they need to do tonight, based on their
 * current phase and day within that phase.
 *
 * The "Description" column in the Phases tab drives the checklist.
 * Pipe-separated steps become interactive checkboxes (e.g. "Step 1|Step 2|Step 3").
 * Checkoffs are persisted to the "Tonight Checklist" column on the Daily Status row
 * for today via /api/acknowledge.
 *
 * Props:
 *   tonightInfo             – phase/day info (from getServerSideProps)
 *   isBreakNight            – boolean
 *   subjectId               – for API writes
 *   studySlug               – for API writes
 *   todayStr                – YYYY-MM-DD string for today
 *   initialTonightChecklist – string[] of already-checked step keys (e.g. ['step_0','step_2'])
 *
 * Config keys (Study Config tab):
 *   show_tonight | true   ← set to "false" to hide this card entirely
 */

import { useState } from 'react';

function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ── Checkbox sub-component ────────────────────────────────────────────────────
function CheckItem({ label, checked, saving, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={saving}
      className={`w-full flex items-start gap-3 text-left rounded-xl px-4 py-3 transition-colors
        ${checked
          ? 'bg-emerald-50 hover:bg-emerald-100'
          : 'bg-white/70 hover:bg-white'
        }
        ${saving ? 'opacity-60 cursor-wait' : 'cursor-pointer'}
      `}
    >
      {/* Checkbox circle */}
      <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
        ${checked
          ? 'bg-emerald-500 border-emerald-500'
          : 'border-slate-300 bg-white'
        }`}
      >
        {checked && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>

      <span className={`text-sm leading-snug ${checked ? 'text-emerald-800 line-through decoration-emerald-400' : 'text-slate-700'}`}>
        {label}
      </span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TonightCard({
  tonightInfo,
  isBreakNight,
  subjectId,
  studySlug,
  todayStr,
  initialTonightChecklist = [],
}) {
  const dateStr = todayLabel();

  // Build checked set from server-provided initial state
  const [checked, setChecked] = useState(() => new Set(initialTonightChecklist));
  const [saving, setSaving]   = useState(null); // which step key is saving

  // Break night takes priority
  if (isBreakNight) {
    return (
      <div className="card border-slate-100">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
              Tonight · {dateStr}
            </p>
            <h3 className="text-base font-bold text-slate-800">Break Night</h3>
            <p className="text-sm text-slate-500 mt-1">
              You have a scheduled break tonight. No data collection is required — enjoy the night off!
            </p>
          </div>
        </div>
      </div>
    );
  }

  // No phase info available
  if (!tonightInfo) return null;

  const {
    phaseName,
    phaseDescription,
    phaseGoal,
    dayLabel,
    dayNumber,
    completedDays,
    totalDays,
  } = tonightInfo;

  const displayDay = dayLabel || (dayNumber ? `Night ${dayNumber}` : null);
  const pct        = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;

  // Parse description into steps (pipe-separated → checklist items)
  // If no pipes, treat the whole description as a single step.
  const rawSteps = phaseDescription
    ? phaseDescription.split('|').map(s => s.trim()).filter(Boolean)
    : [];
  const hasChecklist = rawSteps.length > 0;
  const allDone      = hasChecklist && rawSteps.every((_, i) => checked.has(`step_${i}`));

  // Toggle a step on/off and persist to the sheet
  async function handleToggle(stepKey) {
    if (!subjectId || !todayStr) return; // no-op if props missing (e.g. preview)

    const nowChecked = checked.has(stepKey);
    setSaving(stepKey);

    // Optimistic update
    setChecked(prev => {
      const next = new Set(prev);
      nowChecked ? next.delete(stepKey) : next.add(stepKey);
      return next;
    });

    try {
      await fetch('/api/acknowledge', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:        subjectId,
          study:     studySlug,
          fieldName: stepKey,
          dateStr:   todayStr,
          action:    nowChecked ? 'remove' : 'add',
          column:    'Tonight Checklist',
        }),
      });
    } catch {
      // Revert on failure
      setChecked(prev => {
        const next = new Set(prev);
        nowChecked ? next.add(stepKey) : next.delete(stepKey);
        return next;
      });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="card border-brand-100 bg-brand-50/40">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-brand-500 uppercase tracking-wide mb-0.5">Tonight · {dateStr}</p>
            <h3 className="text-base font-bold text-slate-800">
              {phaseName}{displayDay ? ` · ${displayDay}` : ''}
            </h3>
          </div>
        </div>

        {/* Phase progress pill */}
        {totalDays > 0 && (
          <div className="text-right shrink-0">
            <span className="text-xs font-semibold text-brand-600 bg-brand-100 px-2.5 py-1 rounded-full">
              {completedDays}/{totalDays} nights done
            </span>
          </div>
        )}
      </div>

      {/* Phase progress bar */}
      {totalDays > 0 && (
        <div className="w-full h-1.5 bg-brand-100 rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-brand-500 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Checklist from Description column */}
      {hasChecklist ? (
        <div className="space-y-2">
          {/* "All done" banner */}
          {allDone && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-1">
              <svg className="w-5 h-5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-semibold text-emerald-700">You're all set for tonight!</p>
            </div>
          )}

          <p className="text-xs font-semibold text-slate-500 px-1 mb-1">
            Check off each step as you complete it:
          </p>

          {rawSteps.map((step, i) => {
            const key = `step_${i}`;
            return (
              <CheckItem
                key={key}
                label={step}
                checked={checked.has(key)}
                saving={saving === key}
                onToggle={() => handleToggle(key)}
              />
            );
          })}
        </div>
      ) : (
        /* Fallback: no pipe-separated steps — just show description as text */
        <div className="space-y-2">
          {phaseDescription && (
            <div className="bg-white/70 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-slate-500 mb-1">What to do tonight</p>
              <p className="text-sm text-slate-700">{phaseDescription}</p>
            </div>
          )}
          {phaseGoal && (
            <div className="bg-white/70 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-slate-500 mb-1">Goal</p>
              <p className="text-sm text-slate-700">{phaseGoal}</p>
            </div>
          )}
        </div>
      )}

      {/* Goal — always shown below checklist if present */}
      {hasChecklist && phaseGoal && (
        <div className="bg-white/70 rounded-xl px-4 py-3 mt-2">
          <p className="text-xs font-semibold text-slate-500 mb-1">Goal</p>
          <p className="text-sm text-slate-700">{phaseGoal}</p>
        </div>
      )}
    </div>
  );
}
