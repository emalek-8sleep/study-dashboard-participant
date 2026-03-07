/**
 * ShippingCard
 *
 * Displays all shipments for a participant from the Shipments sheet tab.
 * One row per package — coordinator adds/removes rows freely.
 *
 * Sheet columns: Subject ID | Package Name | Tracking URL | Tracking Status
 *
 * States:
 *   - No shipments at all        → "Materials being prepared" placeholder
 *   - All delivered              → compact green "all delivered" banner
 *   - Mix of statuses            → full card with a row per package
 */

const isDelivered = (s) => (s || '').toLowerCase().includes('deliver');

const allDelivered = (shipments) =>
  shipments.length > 0 && shipments.every((s) => isDelivered(s['Tracking Status']));

function statusStyle(status) {
  const v = (status || '').toLowerCase();
  if (v.includes('deliver'))            return { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
  if (v.includes('out for'))            return { dot: 'bg-brand-500',   badge: 'bg-brand-50 text-brand-700 border-brand-100' };
  if (v.includes('transit'))            return { dot: 'bg-sky-400',     badge: 'bg-sky-50 text-sky-700 border-sky-100' };
  if (v.includes('label') || v.includes('picked')) return { dot: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 border-amber-100' };
  return { dot: 'bg-slate-300', badge: 'bg-slate-50 text-slate-500 border-slate-100' };
}

export default function ShippingCard({ shipments }) {
  // Nothing shipped yet
  if (!shipments || shipments.length === 0) {
    return (
      <div className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4">
        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-700">Your study materials are being prepared</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Tracking info will appear here once your kit has shipped.
          </p>
        </div>
      </div>
    );
  }

  // All packages delivered — show compact banner
  if (allDelivered(shipments)) {
    return (
      <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-4">
        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-emerald-800">All materials delivered!</p>
          <p className="text-xs text-emerald-600 mt-0.5">
            {shipments.map((s) => s['Package Name']).filter(Boolean).join(', ')} · Follow the setup guide to get started.
          </p>
        </div>
        {/* Still let them see individual tracking links */}
        <div className="flex gap-2 flex-wrap justify-end">
          {shipments.filter((s) => s['Tracking URL']).map((s, i) => (
            <a
              key={i}
              href={s['Tracking URL']}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-600 hover:text-emerald-800 underline underline-offset-2 shrink-0"
            >
              {s['Package Name'] || `Package ${i + 1}`}
            </a>
          ))}
        </div>
      </div>
    );
  }

  // Mixed statuses — full card with one row per package
  const pending    = shipments.filter((s) => !isDelivered(s['Tracking Status']));
  const delivered  = shipments.filter((s) =>  isDelivered(s['Tracking Status']));

  return (
    <div className="card border-slate-100">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
          <svg className="w-4.5 h-4.5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Study Materials</h3>
          <p className="text-xs text-slate-400">
            {pending.length} of {shipments.length} package{shipments.length !== 1 ? 's' : ''} still on the way
          </p>
        </div>
      </div>

      {/* Package rows */}
      <div className="space-y-2">
        {shipments.map((s, i) => {
          const name    = s['Package Name']    || `Package ${i + 1}`;
          const url     = s['Tracking URL']    || '';
          const status  = s['Tracking Status'] || (url ? 'In Transit' : 'Pending');
          const styles  = statusStyle(status);
          const done    = isDelivered(status);

          return (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                done ? 'bg-slate-50 border-slate-100' : 'bg-white border-slate-100'
              }`}
            >
              {/* Status dot */}
              <span className={`w-2 h-2 rounded-full shrink-0 ${styles.dot}`} />

              {/* Package name */}
              <span className={`text-sm font-medium flex-1 ${done ? 'text-slate-400' : 'text-slate-700'}`}>
                {name}
              </span>

              {/* Status badge */}
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${styles.badge}`}>
                {status}
              </span>

              {/* Track button */}
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition shrink-0 ${
                    done
                      ? 'text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200'
                      : 'text-white bg-brand-600 hover:bg-brand-700'
                  }`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Track
                </a>
              ) : (
                <span className="text-xs text-slate-300 px-3 py-1.5 shrink-0">No link yet</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
