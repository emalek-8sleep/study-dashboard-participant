/**
 * /admin — Study Coordinator Dashboard
 *
 * Multi-study: the active study is stored in the `active_study` cookie.
 * After logging in, you can switch studies using the dropdown in the header.
 * Each study has its own session cookie (admin_session_<slug>) so you only
 * need to log in to each study once per browser session.
 *
 * Authentication flow:
 *   1. Visit /admin → see login form for the active (or first) study
 *   2. Submit code → POST to /api/admin-auth → sets per-study session cookie → redirect
 *   3. Switch studies → POST to /api/switch-study → updates active_study cookie → redirect
 */

import Head    from 'next/head';
import { useState } from 'react';

// ─── Server-side ─────────────────────────────────────────────────────────────

export async function getServerSideProps({ req, query }) {
  const { getStudies, getSheetIdBySlug } = await import('../lib/studies');
  const {
    getStudyConfig, getAllParticipants, getAllDailyStatuses,
    getAllComments, getPhases, getCheckinFields, deriveProgress,
  } = await import('../lib/sheets');

  const studies = getStudies();
  const cookies = parseCookies(req.headers.cookie || '');

  // Determine which study is currently active
  const activeSlug  = decodeURIComponent(cookies['active_study'] || '') || (studies[0]?.slug || '');
  const activeStudy = studies.find((s) => s.slug === activeSlug) || studies[0];
  const sheetId     = activeStudy?.sheetId || '';

  // Resolve admin code: prefer env var over sheet value
  // Env var format: ADMIN_CODE_<SLUG> (e.g. ADMIN_CODE_FULL_MOON) or ADMIN_CODE
  const slugEnvKey = `ADMIN_CODE_${activeSlug.toUpperCase().replace(/-/g, '_')}`;
  const envCode    = (process.env[slugEnvKey] || process.env.ADMIN_CODE || '').trim();

  let adminCode;
  let config = {};
  if (envCode) {
    adminCode = envCode;
    // Still load config for study_name branding, but skip if no sheetId
    if (sheetId) config = await getStudyConfig(sheetId);
  } else {
    config    = sheetId ? await getStudyConfig(sheetId) : {};
    adminCode = (config.admin_code || '').trim();
  }

  // Check the per-study session cookie: admin_session_<slug>
  const sessionCookieName = `admin_session_${activeSlug}`;
  const sessionCode       = decodeURIComponent(cookies[sessionCookieName] || '');
  const authenticated     = !!(adminCode && sessionCode === adminCode);

  if (!authenticated) {
    return {
      props: {
        authenticated:      false,
        studyName:          config.study_name || activeStudy?.name || 'Study Dashboard',
        error:              query.error || null,
        adminCodeConfigured: !!adminCode,
        studies:            studies,
        activeSlug,
      },
    };
  }

  // Fetch all data for this study in parallel
  const [participants, allStatuses, allComments, phases, checkinFields] = await Promise.all([
    getAllParticipants(sheetId),
    getAllDailyStatuses(sheetId),
    getAllComments(sheetId),
    getPhases(sheetId),
    getCheckinFields(sheetId),
  ]);

  // Build per-participant summary
  const summaries = participants.map((p) => {
    const id      = (p['Subject ID'] || '').trim();
    const normId  = id.toLowerCase();
    const progress = deriveProgress(p, phases);
    const status   = allStatuses[normId] || null;

    const completedDays = progress.reduce((s, ph) => s + ph.completedDays, 0);
    const totalDays     = progress.reduce((s, ph) => s + ph.totalDays, 0);
    const pct           = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;
    const currentPhase  = progress.find((ph) => ph.status === 'inprogress') || progress.find((ph) => ph.status === 'pending');

    const issueCount = status
      ? checkinFields.filter((f) => isInvalid(status[f['Column Name']] || '')).length
      : 0;
    const checkinGood = status
      ? issueCount === 0 && checkinFields.some((f) => isValid(status[f['Column Name']] || ''))
      : false;
    const checkinDate = status ? status['Date'] : null;

    const participantComments = allComments.filter(
      (c) => (c['Subject ID'] || '').toLowerCase().trim() === normId
    );
    const openComments = participantComments.filter((c) => !(c['Coordinator Response'] || '').trim());

    return {
      id,
      firstName:          p['First Name'] || '',
      lastName:           p['Last Name']  || '',
      pct,
      completedDays,
      totalDays,
      currentPhase:       currentPhase ? currentPhase.phaseName : null,
      currentPhaseStatus: currentPhase ? currentPhase.status : null,
      issueCount,
      checkinGood,
      checkinDate,
      noData:             !status,
      openComments:       openComments.length,
      totalComments:      participantComments.length,
    };
  });

  summaries.sort((a, b) => {
    const aUrgent = (a.issueCount > 0 || a.openComments > 0) ? 0 : 1;
    const bUrgent = (b.issueCount > 0 || b.openComments > 0) ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    return (a.id).localeCompare(b.id);
  });

  const stats = {
    total:        summaries.length,
    withIssues:   summaries.filter((s) => s.issueCount > 0).length,
    noData:       summaries.filter((s) => s.noData).length,
    openComments: summaries.filter((s) => s.openComments > 0).length,
    allGood:      summaries.filter((s) => s.checkinGood).length,
  };

  return {
    props: {
      authenticated: true,
      studyName:     config.study_name || activeStudy?.name || 'Study Dashboard',
      summaries,
      stats,
      studies,
      activeSlug,
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage({
  authenticated, studyName, error, adminCodeConfigured,
  summaries, stats, studies, activeSlug,
}) {
  if (!authenticated) {
    return (
      <AdminLogin
        studyName={studyName}
        error={error}
        adminCodeConfigured={adminCodeConfigured}
        studies={studies}
        activeSlug={activeSlug}
      />
    );
  }
  return (
    <AdminDashboard
      studyName={studyName}
      summaries={summaries}
      stats={stats}
      studies={studies}
      activeSlug={activeSlug}
    />
  );
}

// ─── Login form ───────────────────────────────────────────────────────────────

function AdminLogin({ studyName, adminCodeConfigured, studies, activeSlug }) {
  const [code, setCode]         = useState('');
  const [study, setStudy]       = useState(activeSlug || studies[0]?.slug || '');
  const [loading, setLoading]   = useState(false);
  const [loginError, setLoginError] = useState('');
  const multiStudy              = studies.length > 1;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setLoginError('');
    try {
      const body = new URLSearchParams({ code: code.trim(), study });
      const res  = await fetch('/api/admin-auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString(),
      });
      // API redirects to /admin on success, /admin?error=invalid on failure
      if (res.url && res.url.includes('error=')) {
        setLoginError('Incorrect code — please try again.');
        setLoading(false);
      } else {
        window.location.href = '/admin';
      }
    } catch {
      setLoginError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Admin Login · {studyName}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-700 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 backdrop-blur mb-4">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">
              {multiStudy ? 'Coordinator Dashboard' : studyName}
            </h1>
            <p className="text-slate-300 text-sm mt-1">
              {multiStudy ? 'Eight Sleep Research Studies' : 'Coordinator Dashboard'}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Admin Access</h2>

            {!adminCodeConfigured && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 mb-4">
                No admin code configured. Add <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">admin_code</code> to your Study Config tab.
              </div>
            )}

            {loginError && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">
                {loginError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Study selector — only shown with multiple studies */}
              {multiStudy && (
                <div>
                  <label htmlFor="studySelect" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Study
                  </label>
                  <div className="relative">
                    <select
                      id="studySelect"
                      value={study}
                      onChange={(e) => setStudy(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-500 text-slate-800 text-sm transition appearance-none bg-white pr-10"
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

              <div>
                <label htmlFor="code" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Admin Code
                </label>
                <input
                  id="code"
                  type="password"
                  value={code}
                  onChange={(e) => { setCode(e.target.value); setLoginError(''); }}
                  placeholder="Enter your admin code"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-500 text-slate-800 text-sm transition"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold rounded-xl transition disabled:opacity-40"
              >
                {loading ? 'Verifying…' : 'Access Dashboard'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main admin dashboard ──────────────────────────────────────────────────────

function AdminDashboard({ studyName, summaries, stats, studies, activeSlug }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const multiStudy          = studies.length > 1;

  const filtered = summaries.filter((s) => {
    const matchSearch = !search || (
      s.id.toLowerCase().includes(search.toLowerCase()) ||
      s.firstName.toLowerCase().includes(search.toLowerCase()) ||
      (s.lastName || '').toLowerCase().includes(search.toLowerCase())
    );
    const matchFilter =
      filter === 'all'      ? true :
      filter === 'issues'   ? s.issueCount > 0 :
      filter === 'comments' ? s.openComments > 0 :
      filter === 'nodata'   ? s.noData : true;
    return matchSearch && matchFilter;
  });

  return (
    <>
      <Head>
        <title>Admin · {studyName}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="min-h-screen bg-slate-50">
        {/* Top bar */}
        <header className="bg-slate-900 text-white px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="min-w-0">
                <h1 className="text-lg font-bold truncate">{studyName}</h1>
                <p className="text-slate-400 text-xs mt-0.5">Coordinator Dashboard</p>
              </div>

              {/* Study switcher — only shown with multiple studies */}
              {multiStudy && (
                <form action="/api/switch-study" method="POST" className="shrink-0">
                  <div className="relative">
                    <select
                      name="study"
                      defaultValue={activeSlug}
                      onChange={(e) => e.currentTarget.form.requestSubmit()}
                      className="appearance-none bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-3 py-2 pr-7 rounded-lg border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 cursor-pointer transition"
                    >
                      {studies.map((s) => (
                        <option key={s.slug} value={s.slug} className="text-slate-800 bg-white">
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                      <svg className="w-3 h-3 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </form>
              )}
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <a href="/onboarding" className="text-slate-400 hover:text-white text-xs transition flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Study
              </a>
              <a href="/" className="text-slate-400 hover:text-white text-xs transition shrink-0">
                ← Participant Login
              </a>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

          {/* ── Stats cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            <StatCard label="Total Participants" value={stats.total}        color="slate" />
            <StatCard label="Check-in Issues"    value={stats.withIssues}   color="red"   alert={stats.withIssues > 0} />
            <StatCard label="Open Questions"     value={stats.openComments} color="amber" alert={stats.openComments > 0} />
            <StatCard label="No Data Today"      value={stats.noData}       color="slate" />
          </div>

          {/* ── Filters & search ── */}
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Search by Subject ID or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            />
            <div className="flex gap-2 flex-wrap">
              {[
                { key: 'all',      label: `All (${stats.total})` },
                { key: 'issues',   label: `Issues (${stats.withIssues})` },
                { key: 'comments', label: `Open Q (${stats.openComments})` },
                { key: 'nodata',   label: `No Data (${stats.noData})` },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-2.5 rounded-xl text-xs font-semibold transition min-h-[40px] ${
                    filter === f.key
                      ? 'bg-slate-800 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Participant table (desktop) / cards (mobile) ── */}

          {/* Mobile: card list */}
          <div className="md:hidden space-y-3">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-2xl border border-slate-100">
                No participants match your filter.
              </div>
            ) : filtered.map((s) => (
              <ParticipantCard key={s.id} s={s} />
            ))}
          </div>

          {/* Desktop: scrollable table */}
          <div className="hidden md:block bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[700px]">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr_80px_80px] gap-4 px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <span>Participant</span>
                  <span>Phase</span>
                  <span>Progress</span>
                  <span>Last Check-in</span>
                  <span>Issues</span>
                  <span>Questions</span>
                </div>

                {filtered.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-sm">
                    No participants match your filter.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {filtered.map((s) => (
                      <ParticipantRow key={s.id} s={s} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Sheet Settings Reference ── */}
          <div className="mt-8 bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-800">Dashboard Settings</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Control these features by adding rows to the <strong>Study Config</strong> tab in your Google Sheet.
              </p>
            </div>
            <div className="divide-y divide-slate-50">
              {[
                {
                  key:     'show_tonight',
                  values:  'true / false',
                  default: 'true',
                  label:   'Tonight Card',
                  desc:    "Shows participants what phase/night they're on tonight and what to do. Set to false to hide.",
                },
                {
                  key:     'show_full_history',
                  values:  'true / false',
                  default: 'false',
                  label:   'Full History View',
                  desc:    'When true, all previous nights are expanded by default on the dashboard instead of collapsed behind a toggle.',
                },
              ].map(({ key, values, default: def, label, desc }) => (
                <div key={key} className="px-6 py-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-slate-700">{label}</span>
                      <code className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">{key}</code>
                    </div>
                    <p className="text-xs text-slate-500">{desc}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-slate-400">Values: <span className="text-slate-600 font-medium">{values}</span></div>
                    <div className="text-xs text-slate-400 mt-0.5">Default: <span className="text-slate-600 font-medium">{def}</span></div>
                  </div>
                </div>
              ))}
              <div className="px-6 py-4 flex items-start gap-4 bg-slate-50/60">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-slate-700">Break Nights</span>
                    <code className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">Break Nights</code>
                    <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold">Participants tab</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Add a <strong>Break Nights</strong> column to the Participants tab. Enter comma-separated dates for nights off{' '}
                    <span className="font-mono text-slate-600">(e.g. 2025-03-10, 2025-03-17)</span>.{' '}
                    Those nights show as "Break night" in history and the Tonight card reflects it.
                  </p>
                </div>
              </div>
            </div>
          </div>

        </main>
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, color, alert }) {
  const colors = {
    red:   alert ? 'bg-red-50 border-red-100 text-red-700'       : 'bg-slate-50 border-slate-100 text-slate-600',
    amber: alert ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-slate-50 border-slate-100 text-slate-600',
    slate: 'bg-white border-slate-100 text-slate-600',
  };
  return (
    <div className={`rounded-2xl border p-4 ${colors[color] || colors.slate}`}>
      <div className="text-3xl font-bold text-slate-800">{value}</div>
      <div className="text-xs font-medium mt-1 text-slate-500">{label}</div>
    </div>
  );
}

function ParticipantRow({ s }) {
  const hasIssues   = s.issueCount > 0;
  const hasComments = s.openComments > 0;

  return (
    <a
      href={`/dashboard/${encodeURIComponent(s.id)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="grid grid-cols-[1fr_1fr_1fr_1fr_80px_80px] gap-4 px-5 py-4 hover:bg-slate-50 transition items-center"
    >
      <div>
        <span className="text-sm font-semibold text-slate-800">{s.id}</span>
        {(s.firstName || s.lastName) && (
          <span className="text-xs text-slate-400 ml-2">{s.firstName} {s.lastName}</span>
        )}
      </div>

      <div>
        {s.currentPhase ? (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            s.currentPhaseStatus === 'inprogress'
              ? 'bg-brand-50 text-brand-700'
              : 'bg-slate-100 text-slate-500'
          }`}>
            {s.currentPhase}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {s.totalDays > 0 ? (
          <>
            <div className="flex-1 bg-slate-100 rounded-full h-1.5 max-w-[80px]">
              <div className="bg-brand-500 h-1.5 rounded-full" style={{ width: `${s.pct}%` }} />
            </div>
            <span className="text-xs font-medium text-slate-500 shrink-0">{s.pct}%</span>
          </>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </div>

      <div>
        {s.noData ? (
          <span className="text-xs text-slate-400">No data</span>
        ) : s.checkinGood ? (
          <span className="text-xs font-semibold text-emerald-600">✓ All good</span>
        ) : (
          <span className="text-xs text-slate-500">
            {s.checkinDate ? new Date(s.checkinDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
          </span>
        )}
      </div>

      <div>
        {hasIssues ? (
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] rounded-full bg-red-100 text-red-600 text-xs font-bold px-1.5">
            {s.issueCount}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </div>

      <div>
        {hasComments ? (
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] rounded-full bg-amber-100 text-amber-700 text-xs font-bold px-1.5">
            {s.openComments}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </div>
    </a>
  );
}

function ParticipantCard({ s }) {
  const hasIssues   = s.issueCount > 0;
  const hasComments = s.openComments > 0;
  const urgent      = hasIssues || hasComments;

  return (
    <a
      href={`/dashboard/${encodeURIComponent(s.id)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`block bg-white rounded-2xl border p-4 hover:shadow-sm transition ${
        urgent ? 'border-red-100' : 'border-slate-100'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <span className="text-sm font-bold text-slate-800">{s.id}</span>
          {(s.firstName || s.lastName) && (
            <span className="text-xs text-slate-400 ml-2">{s.firstName} {s.lastName}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasIssues && (
            <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">
              {s.issueCount} issue{s.issueCount > 1 ? 's' : ''}
            </span>
          )}
          {hasComments && (
            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {s.openComments} Q
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-500">
        {s.currentPhase && (
          <span className={`px-2 py-0.5 rounded-full font-medium ${
            s.currentPhaseStatus === 'inprogress' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {s.currentPhase}
          </span>
        )}
        {s.totalDays > 0 && (
          <div className="flex items-center gap-1.5 flex-1">
            <div className="flex-1 bg-slate-100 rounded-full h-1.5 max-w-[60px]">
              <div className="bg-brand-500 h-1.5 rounded-full" style={{ width: `${s.pct}%` }} />
            </div>
            <span className="font-medium text-slate-500">{s.pct}%</span>
          </div>
        )}
        <span className={`ml-auto font-medium ${
          s.noData ? 'text-slate-300' : s.checkinGood ? 'text-emerald-600' : 'text-slate-400'
        }`}>
          {s.noData ? 'No data' : s.checkinGood ? '✓ All good' : s.checkinDate
            ? new Date(s.checkinDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '—'}
        </span>
      </div>
    </a>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCookies(cookieHeader) {
  const result = {};
  cookieHeader.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) result[key.trim()] = rest.join('=').trim();
  });
  return result;
}

function isValid(val) {
  const v = (val || '').toString().toLowerCase().trim();
  return v === 'yes' || v === 'true' || v === 'complete' || v === 'valid' || v === 'pass';
}

function isInvalid(val) {
  const v = (val || '').toString().toLowerCase().trim();
  return v === 'no' || v === 'false' || v === 'incomplete' || v === 'invalid' || v === 'fail';
}
