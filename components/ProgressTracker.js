import { useState } from 'react';

const STATUS_CONFIG = {
  complete:   { label: 'Complete',    badgeClass: 'badge-complete',   barColor: 'bg-emerald-500', ringColor: 'ring-emerald-200',  bg: 'bg-emerald-50',  text: 'text-emerald-600', icon: '✓' },
  inprogress: { label: 'In Progress', badgeClass: 'badge-inprogress', barColor: 'bg-blue-500',    ringColor: 'ring-blue-200',    bg: 'bg-blue-50',    text: 'text-blue-600',   icon: '→' },
  pending:    { label: 'Upcoming',    badgeClass: 'badge-pending',    barColor: 'bg-slate-200',   ringColor: 'ring-slate-100',   bg: 'bg-slate-100',  text: 'text-slate-400',  icon: '○' },
  missed:     { label: 'Missed',      badgeClass: 'badge-missed',     barColor: 'bg-red-400',     ringColor: 'ring-red-100',     bg: 'bg-red-50',     text: 'text-red-500',    icon: '!' },
  withdrawn:  { label: 'Withdrawn',   badgeClass: 'badge-pending',    barColor: 'bg-slate-200',   ringColor: 'ring-slate-100',   bg: 'bg-slate-100',  text: 'text-slate-400',  icon: '–' },
};

const DAY_STATUS = {
  complete:   { bg: 'bg-emerald-500', text: 'text-white',      border: 'border-emerald-500', tooltip: 'Complete'    },
  inprogress: { bg: 'bg-blue-500',    text: 'text-white',      border: 'border-blue-500',   tooltip: 'In Progress' },
  pending:    { bg: 'bg-white',       text: 'text-slate-300',  border: 'border-slate-200',  tooltip: 'Upcoming'    },
  missed:     { bg: 'bg-red-400',     text: 'text-white',      border: 'border-red-400',    tooltip: 'Missed'      },
  withdrawn:  { bg: 'bg-slate-200',   text: 'text-slate-400',  border: 'border-slate-200',  tooltip: 'Withdrawn'   },
};

export default function ProgressTracker({ progress }) {
  const [expanded, setExpanded] = useState(null);
  const toggle = (i) => setExpanded(expanded === i ? null : i);

  // Overall study progress
  const totalDays     = progress.reduce((s, p) => s + p.totalDays, 0);
  const completedDays = progress.reduce((s, p) => s + p.completedDays, 0);

  return (
    <div className="space-y-3">

      {/* Overall timeline bar */}
      <div className="card py-4 mb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Study Timeline</span>
          <span className="text-xs text-slate-400">{completedDays} of {totalDays} days complete</span>
        </div>
        <div className="flex gap-1 items-end">
          {progress.map((phase, i) => {
            const cfg = STATUS_CONFIG[phase.status] || STATUS_CONFIG.pending;
            const widthClass = phase.totalDays === 1 ? 'flex-none w-8' : 'flex-1';
            return (
              <div key={i} className={`${widthClass} flex flex-col items-center gap-1`}>
                <div className="w-full flex gap-0.5">
                  {phase.days.map((day, di) => {
                    const ds = DAY_STATUS[day.status] || DAY_STATUS.pending;
                    return (
                      <div key={di}
                        title={`${phase.phaseName} ${day.dayLabel}: ${ds.tooltip}`}
                        className={`flex-1 h-2.5 rounded-sm ${ds.bg} border ${ds.border} transition-all`}
                      />
                    );
                  })}
                </div>
                <span className="text-[9px] text-slate-400 font-medium text-center leading-tight hidden sm:block truncate w-full text-center">
                  {phase.phaseName.length > 10 ? phase.phaseName.slice(0, 10) + '…' : phase.phaseName}
                </span>
              </div>
            );
          })}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <span key={k} className={`badge ${v.badgeClass} text-[10px]`}>{v.label}</span>
          ))}
        </div>
      </div>

      {/* Phase cards */}
      {progress.map((phase, i) => {
        const cfg    = STATUS_CONFIG[phase.status] || STATUS_CONFIG.pending;
        const isOpen = expanded === i;
        const isMultiDay = phase.totalDays > 1;

        return (
          <div
            key={i}
            className={`card transition-all cursor-pointer hover:shadow-md ${
              phase.status === 'inprogress' ? 'border-brand-300 ring-1 ring-brand-200' : ''
            }`}
            onClick={() => toggle(i)}
          >
            <div className="flex items-center gap-4">
              {/* Phase status icon */}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${cfg.bg} ${cfg.text}`}>
                {isMultiDay ? (
                  <span className="text-xs font-bold">{phase.completedDays}/{phase.totalDays}</span>
                ) : (
                  cfg.icon
                )}
              </div>

              {/* Title + badges */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 text-sm">{phase.phaseName}</span>
                  <span className={`badge ${cfg.badgeClass}`}>{cfg.label}</span>
                  {phase.status === 'inprogress' && (
                    <span className="badge bg-brand-100 text-brand-700">Current Phase</span>
                  )}
                </div>

                {/* Day dots */}
                {isMultiDay && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {phase.days.map((day, di) => {
                      const ds = DAY_STATUS[day.status] || DAY_STATUS.pending;
                      return (
                        <div key={di}
                          title={`${day.dayLabel}: ${ds.tooltip}`}
                          className={`w-5 h-5 rounded-full border-2 ${ds.bg} ${ds.border} flex items-center justify-center`}>
                          <span className={`text-[9px] font-bold ${ds.text}`}>{di + 1}</span>
                        </div>
                      );
                    })}
                    <span className="text-xs text-slate-400 ml-1">
                      {phase.completedDays === phase.totalDays
                        ? 'All days complete'
                        : `${phase.completedDays} of ${phase.totalDays} days`}
                    </span>
                  </div>
                )}
              </div>

              {/* Expand chevron */}
              <svg
                className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            {/* Expanded: day breakdown + description */}
            {isOpen && (
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">

                {/* Day-by-day breakdown */}
                {isMultiDay && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Day Breakdown</p>
                    <div className="space-y-1.5">
                      {phase.days.map((day, di) => {
                        const ds  = DAY_STATUS[day.status] || DAY_STATUS.pending;
                        const cfg2 = STATUS_CONFIG[day.status] || STATUS_CONFIG.pending;
                        return (
                          <div key={di} className="flex items-center gap-3 py-1.5 px-3 rounded-lg bg-slate-50">
                            <div className={`w-6 h-6 rounded-full border-2 ${ds.bg} ${ds.border} flex items-center justify-center shrink-0`}>
                              <span className={`text-[10px] font-bold ${ds.text}`}>{di + 1}</span>
                            </div>
                            <span className="text-sm text-slate-700 flex-1">
                              {day.dayLabel || `Day ${di + 1}`}
                            </span>
                            <span className={`badge ${cfg2.badgeClass}`}>{cfg2.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Goal */}
                {phase.goal && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Goal</p>
                    <p className="text-sm text-slate-700 leading-relaxed">{phase.goal}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
