/**
 * ShippingCard
 *
 * Shows shipment status for the participant's materials.
 * Coordinator fills in two columns in the Participants sheet:
 *   Tracking URL    — full carrier tracking link (UPS, FedEx, USPS, etc.)
 *   Tracking Status — free text, e.g. "In Transit", "Out for Delivery", "Delivered"
 *
 * - If no tracking URL: shows a "not yet shipped" placeholder
 * - If tracking URL + status: shows the status badge + Track Package button
 * - If status contains "deliver": shows a green "delivered" state
 */

const STATUS_DELIVERED = (s) =>
  (s || '').toLowerCase().includes('deliver');

const STATUS_COLORS = (s) => {
  const v = (s || '').toLowerCase();
  if (v.includes('deliver'))      return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (v.includes('out for'))      return 'bg-brand-50 text-brand-700 border-brand-100';
  if (v.includes('transit'))      return 'bg-sky-50 text-sky-700 border-sky-100';
  if (v.includes('label') || v.includes('picked')) return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-slate-50 text-slate-600 border-slate-100';
};

export default function ShippingCard({ trackingUrl, trackingStatus }) {
  const hasTracking  = !!trackingUrl;
  const delivered    = STATUS_DELIVERED(trackingStatus);
  const statusLabel  = trackingStatus || (hasTracking ? 'In Transit' : null);

  // Once delivered and study started, this card can fade to minimal
  if (delivered) {
    return (
      <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-4">
        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-emerald-800">Your materials have been delivered!</p>
          <p className="text-xs text-emerald-600 mt-0.5">
            Follow the setup instructions in your kit to get started.
          </p>
        </div>
        {trackingUrl && (
          <a
            href={trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-emerald-600 hover:text-emerald-800 underline underline-offset-2 shrink-0"
          >
            View tracking
          </a>
        )}
      </div>
    );
  }

  if (!hasTracking) {
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
            A tracking number will appear here once your kit has shipped.
          </p>
        </div>
      </div>
    );
  }

  // Has tracking URL, not yet delivered
  return (
    <div className="card border-slate-100">
      <div className="flex items-center gap-4">
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">Study materials on the way!</p>
          {statusLabel && (
            <span className={`inline-block mt-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${STATUS_COLORS(statusLabel)}`}>
              {statusLabel}
            </span>
          )}
        </div>

        {/* CTA */}
        <a
          href={trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Track Package
        </a>
      </div>
    </div>
  );
}
