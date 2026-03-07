import { useState } from 'react';
import { groupBy } from '../lib/sheets';

export default function TroubleshootingSection({ items }) {
  const grouped = groupBy(items, 'Device');
  const devices  = Object.keys(grouped);
  const [activeDevice, setActiveDevice] = useState(devices[0] || '');
  const [openIssue, setOpenIssue]       = useState(null);

  const currentItems = grouped[activeDevice] || [];

  return (
    <div className="card">
      {/* Device tabs */}
      {devices.length > 1 && (
        <div className="flex gap-2 flex-wrap mb-5 pb-4 border-b border-slate-100">
          {devices.map((device) => (
            <button
              key={device}
              onClick={() => { setActiveDevice(device); setOpenIssue(null); }}
              className={`px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                activeDevice === device
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {device}
            </button>
          ))}
        </div>
      )}

      {/* Issues accordion */}
      <div className="space-y-2">
        {currentItems.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No troubleshooting guides available yet.</p>
        ) : (
          currentItems.map((item, i) => {
            const isOpen = openIssue === i;
            const steps  = parseSteps(item['Steps'] || '');
            const link   = item['Link'] || '';

            return (
              <div key={i} className="rounded-xl border border-slate-100 overflow-hidden">
                <button
                  onClick={() => setOpenIssue(isOpen ? null : i)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition"
                >
                  <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <span className="flex-1 font-medium text-slate-800 text-sm">{item['Issue Title']}</span>
                  <svg className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 border-t border-slate-100 bg-slate-50">
                    {steps.length > 0 ? (
                      <ol className="mt-3 space-y-2">
                        {steps.map((step, si) => (
                          <li key={si} className="flex items-start gap-3">
                            <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                              {si + 1}
                            </span>
                            <span className="text-sm text-slate-700 leading-relaxed">{step}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm text-slate-500 mt-3">{item['Steps']}</p>
                    )}

                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-4 text-sm text-brand-600 hover:text-brand-700 font-medium"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        View full guide
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * Parse steps from a cell — supports:
 *  - Numbered: "1. Do this\n2. Do that"
 *  - Pipe-separated: "Do this | Do that"
 *  - Semicolon-separated: "Do this; Do that"
 *  - Plain text (returned as single item)
 */
function parseSteps(raw) {
  if (!raw) return [];
  const trimmed = raw.trim();

  // Newline-separated numbered steps
  if (/\n/.test(trimmed)) {
    return trimmed.split('\n')
      .map(s => s.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(Boolean);
  }

  // Pipe-separated
  if (trimmed.includes(' | ')) {
    return trimmed.split(' | ').map(s => s.trim()).filter(Boolean);
  }

  // Semicolon-separated
  if (trimmed.includes('; ')) {
    return trimmed.split('; ').map(s => s.trim()).filter(Boolean);
  }

  // Plain text
  return [trimmed];
}
