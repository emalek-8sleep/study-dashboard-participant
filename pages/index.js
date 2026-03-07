import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export async function getServerSideProps() {
  // Only parse the STUDIES env var here — NO network calls.
  // This keeps the login page instant (no Google Sheets fetch).
  const { getStudies } = await import('../lib/studies');
  const studies = getStudies();

  // Strip sheetId from what we send to the client (keep it server-only)
  const clientStudies = studies.map(({ name, slug }) => ({ name, slug }));
  return { props: { studies: clientStudies } };
}

export default function LoginPage({ studies }) {
  const router = useRouter();
  const [subjectId,    setSubjectId]    = useState('');
  const [studySlug,    setStudySlug]    = useState(studies[0]?.slug || '');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');

  const multiStudy = studies.length > 1;

  // The login page uses simple defaults — study-specific config (branding,
  // verification fields, etc.) is loaded on the dashboard AFTER login.
  const studyName   = 'Study Participant Dashboard';
  const welcomeMsg  = 'Enter your Subject ID to view your study progress and details.';
  const contactEmail = '';

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedId = subjectId.trim();

    if (!trimmedId) {
      setError('Please enter your Subject ID.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({ id: trimmedId, study: studySlug });
      const res  = await fetch(`/api/participant?${params.toString()}`);
      const data = await res.json();

      if (data.found) {
        router.push(`/dashboard/${encodeURIComponent(trimmedId)}`);
      } else {
        setError("We couldn't find that Subject ID. Please double-check and try again, or contact your study coordinator.");
        setLoading(false);
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>{multiStudy ? 'Study Participant Dashboard' : studyName}</title>
        <meta name="description" content="Study participant portal" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-brand-950 via-brand-800 to-brand-600 flex items-center justify-center p-4">
        {/* Subtle background texture */}
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
        }} />

        <div className="relative w-full max-w-md">
          {/* Logo / Study name */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              {multiStudy ? 'Participant Portal' : studyName}
            </h1>
            <p className="text-brand-200 mt-2 text-sm">
              {multiStudy ? 'Eight Sleep Research Studies' : 'Participant Portal'}
            </p>
          </div>

          {/* Login card */}
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-xl font-semibold text-slate-800 mb-1">Welcome</h2>
            <p className="text-slate-500 text-sm mb-6">
              {multiStudy
                ? 'Select your study and enter your Subject ID to access your dashboard.'
                : welcomeMsg}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Study selector — only shown when multiple studies are configured */}
              {multiStudy && (
                <div>
                  <label htmlFor="studySelect" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Study
                  </label>
                  <div className="relative">
                    <select
                      id="studySelect"
                      value={studySlug}
                      onChange={(e) => { setStudySlug(e.target.value); setError(''); }}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-slate-800 text-sm transition appearance-none bg-white pr-10"
                    >
                      {studies.map((s) => (
                        <option key={s.slug} value={s.slug}>{s.name}</option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>
              )}

              {/* Subject ID */}
              <div>
                <label htmlFor="subjectId" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Subject ID
                </label>
                <input
                  id="subjectId"
                  type="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  value={subjectId}
                  onChange={(e) => { setSubjectId(e.target.value); setError(''); }}
                  placeholder="e.g. SBJ-001"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-slate-800 placeholder-slate-300 text-sm transition"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 rounded-xl px-4 py-3 text-sm border border-red-100">
                  <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !subjectId.trim()}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Verifying...
                  </>
                ) : (
                  <>
                    Access My Dashboard
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            {contactEmail && (
              <p className="text-center text-xs text-slate-400 mt-6">
                Need help?{' '}
                <a href={`mailto:${contactEmail}`} className="text-brand-500 hover:text-brand-600 font-medium">
                  Contact your study coordinator
                </a>
              </p>
            )}
          </div>

          <p className="text-center text-brand-300 text-xs mt-6">
            This portal is for study participants only. All data is confidential.
          </p>

          {/* Coordinator access */}
          <div className="text-center mt-4">
            <a
              href="/admin"
              className="text-brand-400 hover:text-brand-200 text-xs transition font-medium"
            >
              Coordinator Access →
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
