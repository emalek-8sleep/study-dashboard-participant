/**
 * CommentsSection
 *
 * Native inline Q&A for participants. Comments are submitted directly on the
 * page (no Google Form redirect). Submissions POST to /api/comment, which
 * calls a Google Apps Script web app that appends the row to the sheet.
 *
 * Coordinators respond in the "Coordinator Response" column; responses appear
 * here on the next page load.
 */
import { useState } from 'react';

function formatDateTime(str) {
  if (!str) return '';
  try {
    return new Date(str).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return str;
  }
}

export default function CommentsSection({ comments: initialComments, subjectId, commentsConfigured }) {
  const [comments, setComments]   = useState(initialComments || []);
  const [text, setText]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);
  const [showForm, setShowForm]   = useState(false);

  const MAX = 1000;

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError('');
    setSuccess(false);

    try {
      const res = await fetch('/api/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, comment: trimmed }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        // Optimistically add to the top of the list
        setComments((prev) => [
          {
            'Subject ID': subjectId,
            'Submitted At': new Date().toISOString(),
            'Comment': trimmed,
            'Coordinator Response': '',
            'Resolved': 'No',
          },
          ...prev,
        ]);
        setText('');
        setSuccess(true);
        setShowForm(false);
      } else {
        setError(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setError('Network error — please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card border-slate-100">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="section-title mb-0">Questions &amp; Comments</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Ask your coordinator anything — they'll respond here.
          </p>
        </div>
        {commentsConfigured && !showForm && (
          <button
            onClick={() => { setShowForm(true); setSuccess(false); }}
            className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 4v16m8-8H4" />
            </svg>
            Ask a Question
          </button>
        )}
      </div>

      {/* Success banner */}
      {success && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm text-emerald-700 mb-4">
          <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          Your question was submitted! Your coordinator will respond here soon.
        </div>
      )}

      {/* Inline form */}
      {showForm && commentsConfigured && (
        <form onSubmit={handleSubmit} className="mb-5 bg-slate-50 rounded-xl p-4 border border-slate-100">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Your question or comment
          </label>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setError(''); }}
            rows={4}
            maxLength={MAX}
            placeholder="Type your question here…"
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm text-slate-800 resize-none transition"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-slate-400">{text.length} / {MAX}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setText(''); setError(''); }}
                className="text-xs text-slate-400 hover:text-slate-600 px-3 py-1.5 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !text.trim()}
                className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition"
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Sending…
                  </>
                ) : 'Submit Question'}
              </button>
            </div>
          </div>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2">
              {error}
            </p>
          )}
        </form>
      )}

      {/* Not configured notice */}
      {!commentsConfigured && (
        <div className="bg-slate-50 rounded-xl px-4 py-3 text-xs text-slate-400 mb-4">
          Comments aren't enabled yet. Add <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">comments_script_url</code> to your Study Config to allow participant questions.
        </div>
      )}

      {/* Comment history */}
      {comments.length > 0 ? (
        <div className="space-y-3">
          {comments.map((c, i) => {
            const responded  = !!(c['Coordinator Response'] || '').trim();
            const isResolved = (c['Resolved'] || '').toString().toLowerCase().trim() === 'yes';

            return (
              <div key={i} className={`rounded-xl border overflow-hidden ${
                isResolved ? 'border-slate-100' : responded ? 'border-emerald-100' : 'border-amber-100'
              }`}>
                {/* Participant's message */}
                <div className="px-4 py-3 bg-slate-50">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-slate-500">
                      You · {formatDateTime(c['Submitted At'])}
                    </span>
                    {isResolved ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        Resolved
                      </span>
                    ) : !responded ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                        Awaiting response
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        Answered
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{c['Comment'] || ''}</p>
                </div>

                {/* Coordinator's response */}
                {responded && (
                  <div className="px-4 py-3 bg-white border-t border-slate-100">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-5 h-5 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                        <svg className="w-3 h-3 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <span className="text-xs font-semibold text-brand-700">Study Coordinator</span>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed ml-7 whitespace-pre-wrap">
                      {c['Coordinator Response']}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 text-slate-400">
          <svg className="w-10 h-10 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <p className="text-sm">No questions yet.</p>
          {commentsConfigured && (
            <p className="text-xs mt-1 text-slate-300">Use the button above to ask your coordinator anything.</p>
          )}
        </div>
      )}
    </div>
  );
}
