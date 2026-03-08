/**
 * TonightCard
 *
 * Shows the participant what they need to do tonight, based on their
 * current phase and day within that phase.
 *
 * Driven entirely by data already in the sheet:
 *   - Current phase / day comes from deriveProgress()
 *   - Break nights come from the "Break Nights" column in Participants tab
 *
 * Config keys (Study Config tab):
 *   show_tonight | true   ← set to "false" to hide this card entirely
 */

export default function TonightCard({ tonightInfo, isBreakNight }) {
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
            <h3 className="text-base font-bold text-slate-800">Tonight — Break Night</h3>
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
            <p className="text-xs font-semibold text-brand-500 uppercase tracking-wide mb-0.5">Tonight</p>
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

      {/* Description / goal */}
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
    </div>
  );
}
