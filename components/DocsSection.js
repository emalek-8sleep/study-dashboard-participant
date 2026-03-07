import { groupBy } from '../lib/sheets';

const CATEGORY_ICONS = {
  'Protocol':      '📋',
  'Instructions':  '📖',
  'Consent':       '✍️',
  'Forms':         '📝',
  'Device':        '📱',
  'Reference':     '📚',
  'Video':         '🎥',
  'FAQ':           '❓',
  'Other':         '📄',
};

function getIcon(category) {
  const key = Object.keys(CATEGORY_ICONS).find(k =>
    (category || '').toLowerCase().includes(k.toLowerCase())
  );
  return key ? CATEGORY_ICONS[key] : '📄';
}

export default function DocsSection({ docs }) {
  const grouped = groupBy(docs, 'Category');

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span>{getIcon(category)}</span>
            <span>{category}</span>
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {items.map((doc, i) => (
              <a
                key={i}
                href={doc['URL']}
                target="_blank"
                rel="noopener noreferrer"
                className="card hover:shadow-md hover:border-brand-200 transition-all group flex items-start gap-4 no-underline"
              >
                <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0 text-lg group-hover:bg-brand-100 transition">
                  {getIcon(category)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm group-hover:text-brand-600 transition">
                    {doc['Title']}
                  </p>
                  {doc['Description'] && (
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{doc['Description']}</p>
                  )}
                </div>
                <svg className="w-4 h-4 text-slate-300 group-hover:text-brand-400 shrink-0 mt-0.5 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
