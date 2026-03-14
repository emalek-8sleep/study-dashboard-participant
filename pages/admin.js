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
import { useState, useRef, useEffect, useMemo } from 'react';

// ─── Server-side ─────────────────────────────────────────────────────────────

export async function getServerSideProps({ req, query }) {
  const { getStudies, getSheetIdBySlug } = await import('../lib/studies');
  const {
    getStudyConfig, getAllParticipants, getAllDailyStatuses,
    getAllComments, getPhases, getCheckinFields, deriveProgress,
    getAllDailyStatusRows, buildMetricsSummary,
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
        studyName:          config.study_short_name || config.study_name || activeStudy?.name || 'Study Dashboard',
        error:              query.error || null,
        adminCodeConfigured: !!adminCode,
        studies:            studies,
        activeSlug,
      },
    };
  }

  // Fetch all data for this study in parallel
  const [participants, allStatuses, allComments, phases, checkinFields, allStatusRows] = await Promise.all([
    getAllParticipants(sheetId),
    getAllDailyStatuses(sheetId),
    getAllComments(sheetId),
    getPhases(sheetId),
    getCheckinFields(sheetId),
    getAllDailyStatusRows(sheetId),
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
      firstName:          p['First Name']  || '',
      lastName:           p['Last Name']   || '',
      lastLogin:          p['Last Login']  || '',
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

  // Phase breakdown — group participants by current phase name
  const phaseCounts = {};
  summaries.forEach((s) => {
    const key = s.currentPhase || 'No Phase / Pending';
    phaseCounts[key] = (phaseCounts[key] || 0) + 1;
  });
  // Sort by phase name so it reads in order
  const phaseBreakdown = Object.entries(phaseCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([phase, count]) => ({ phase, count }));

  // Last-night field stats (valid / invalid counts per check-in field)
  const fieldStats = checkinFields.map((f) => {
    const col     = f['Column Name'] || '';
    const label   = f['Field Label'] || col;
    const valid   = summaries.filter((s) => {
      const status = allStatuses[(s.id || '').toLowerCase()];
      const v = (status?.[col] || '').toString().toLowerCase().trim();
      return v === 'yes' || v === 'true' || v === 'complete' || v === 'valid' || v === 'pass';
    }).length;
    const invalid = summaries.filter((s) => {
      const status = allStatuses[(s.id || '').toLowerCase()];
      const v = (status?.[col] || '').toString().toLowerCase().trim();
      return v === 'no' || v === 'false' || v === 'incomplete' || v === 'invalid' || v === 'fail';
    }).length;
    return { label, valid, invalid, noData: summaries.length - valid - invalid };
  });

  const stats = {
    total:        summaries.length,
    withIssues:   summaries.filter((s) => s.issueCount > 0).length,
    noData:       summaries.filter((s) => s.noData).length,
    openComments: summaries.filter((s) => s.openComments > 0).length,
    allGood:      summaries.filter((s) => s.checkinGood).length,
    phaseBreakdown,
    fieldStats,
  };

  // The "metrics" for the Data tab are ALL Daily Status rows.
  // buildMetricsSummary skips Subject ID, Date, and non-numeric columns automatically.
  const metricsSummary    = buildMetricsSummary(allStatusRows);
  // Column names that are already shown on the participant dashboard (from Check-in Fields)
  const checkinFieldCols  = checkinFields.map((f) => (f['Column Name'] || '').trim()).filter(Boolean);

  return {
    props: {
      authenticated: true,
      studyName:     config.study_short_name || config.study_name || activeStudy?.name || 'Study Dashboard',
      summaries,
      stats,
      metrics:        allStatusRows,
      metricsSummary,
      checkinFieldCols,
      studies,
      activeSlug,
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage({
  authenticated, studyName, error, adminCodeConfigured,
  summaries, stats, metrics, metricsSummary, checkinFieldCols, studies, activeSlug,
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
      metrics={metrics || []}
      metricsSummary={metricsSummary || {}}
      checkinFieldCols={checkinFieldCols || []}
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

function AdminDashboard({ studyName, summaries, stats, metrics, metricsSummary, checkinFieldCols, studies, activeSlug }) {
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState('all');
  const [activeTab,  setActiveTab]  = useState('overview');
  const multiStudy                  = studies.length > 1;

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
              <button
                onClick={() => window.location.reload()}
                className="p-1.5 rounded-lg hover:bg-white/10 transition shrink-0"
                aria-label="Refresh page"
                title="Refresh"
              >
                <svg className="w-4 h-4 text-slate-400 hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
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

        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

          {/* ── Tab navigation ── */}
          <div className="flex items-center gap-1 border-b border-slate-200">
            {[
              { key: 'overview',    label: 'Overview' },
              { key: 'data',        label: `Data${metrics.length > 0 ? ` (${metrics.length})` : ''}` },
              { key: 'eligibility', label: 'Eligibility' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition -mb-px ${
                  activeTab === tab.key
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Study Status Assistant (persists across tabs) ── */}
          <AdminChat stats={stats} metrics={metrics} activeSlug={activeSlug} />

          {/* ── DATA TAB ── */}
          {activeTab === 'data' && (
            <MetricsView
              metrics={metrics}
              metricsSummary={metricsSummary}
              checkinFieldCols={checkinFieldCols}
              activeSlug={activeSlug}
            />
          )}

          {/* ── ELIGIBILITY TAB ── */}
          {activeTab === 'eligibility' && (
            <EligibilityChecker
              metrics={metrics}
              activeSlug={activeSlug}
            />
          )}

          {/* ── OVERVIEW TAB ── */}
          {activeTab === 'overview' && <>

          {/* ── Stats cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            <StatCard label="Total Participants" value={stats.total}        color="slate" />
            <StatCard label="Check-in Issues"    value={stats.withIssues}   color="red"   alert={stats.withIssues > 0} />
            <StatCard label="Open Questions"     value={stats.openComments} color="amber" alert={stats.openComments > 0} />
            <StatCard label="No Data Today"      value={stats.noData}       color="slate" />
          </div>

          {/* ── Study overview: phase breakdown + field stats ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Phase breakdown */}
            {stats.phaseBreakdown.length > 0 && (
              <div className="card border-slate-100">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Participants by Phase</h3>
                <div className="space-y-2">
                  {stats.phaseBreakdown.map(({ phase, count }) => (
                    <div key={phase} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-slate-600 truncate">{phase}</span>
                          <span className="text-xs font-bold text-slate-800 ml-2 shrink-0">{count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-brand-500 transition-all"
                            style={{ width: `${Math.round((count / stats.total) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Last-night field stats */}
            {stats.fieldStats.length > 0 && (
              <div className="card border-slate-100">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Last Night's Check-In Summary</h3>
                <div className="space-y-2">
                  {stats.fieldStats.map(({ label, valid, invalid, noData }) => (
                    <div key={label} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0 text-slate-600 font-medium truncate">{label}</span>
                      <div className="flex items-center gap-1.5 flex-1">
                        {valid > 0 && (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />{valid} valid
                          </span>
                        )}
                        {invalid > 0 && (
                          <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 font-semibold px-2 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />{invalid} issues
                          </span>
                        )}
                        {noData > 0 && (
                          <span className="text-slate-400">{noData} no data</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_80px_80px] gap-4 px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <span>Participant</span>
                  <span>Phase</span>
                  <span>Progress</span>
                  <span>Last Check-in</span>
                  <span>Last Login</span>
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
          <div className="mt-2 bg-white rounded-2xl border border-slate-100 overflow-hidden">
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
                {
                  key:     'Condition',
                  values:  'Any text',
                  default: '—',
                  label:   'Condition Column',
                  desc:    'Add a "Condition" column to the Daily Status tab to tag nights (e.g. Baseline, Testing, Washout). The admin Data tab will show a filter dropdown for it automatically. Leave blank for untagged nights.',
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

          </> /* end overview tab */}

        </main>
      </div>
    </>
  );
}

// ─── AdminChat ────────────────────────────────────────────────────────────────

function AdminChat({ stats, metrics, activeSlug }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hey! I can help you pull together a study status update or dig into your metrics data. What would you like to know?",
    },
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef             = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      const res  = await fetch('/api/admin/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: next, stats, study: activeSlug, metrics: metrics || [] }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply || 'Sorry, something went wrong.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong — please try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  function handleSuggestion(text) {
    setInput(text);
  }

  const hasMetrics = metrics && metrics.length > 0;
  const suggestions = [
    'Generate a study status update for last night',
    'Which participants had issues?',
    ...(hasMetrics ? ['Summarize the metrics data', 'Who has the highest values across all metrics?'] : []),
    ...(!hasMetrics ? ['How many people are in each phase?', "Summarize last night's check-in results"] : []),
  ];

  return (
    <div className="card border-slate-100">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-slate-700">Study Status Assistant</h3>
        <span className="ml-auto text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">Powered by Claude</span>
      </div>

      {/* Message thread */}
      <div className="bg-slate-50 rounded-xl p-4 space-y-3 max-h-72 overflow-y-auto mb-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-100 text-slate-700'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-100 rounded-xl px-3.5 py-2.5">
              <span className="flex gap-1">
                {[0,1,2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestion chips — shown until user sends first message */}
      {messages.length === 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => handleSuggestion(s)}
              className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium px-3 py-1.5 rounded-full transition"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about last night's data or generate a status update…"
          disabled={loading}
          className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl transition disabled:opacity-40 shrink-0"
        >
          Send
        </button>
      </form>
    </div>
  );
}

// ─── MetricsView ─────────────────────────────────────────────────────────────

// Columns that are always internal/system — never shown as metric columns
const INTERNAL_COLS = new Set([
  'Subject ID', 'Date', 'Acknowledgments', 'Tonight Checklist',
]);

function MetricsView({ metrics, metricsSummary, checkinFieldCols, activeSlug }) {
  const [filterPid,       setFilterPid]       = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [sortBy,          setSortBy]          = useState('date');

  // All non-internal columns present in the data
  const allCols = metrics.length > 0
    ? Object.keys(metrics[0]).filter((k) => !INTERNAL_COLS.has(k))
    : [];

  // Separate "Condition" column if it exists (used for filtering, not shown as metric card)
  const hasCondition    = allCols.includes('Condition');
  const displayCols     = allCols.filter((k) => k !== 'Condition');
  const checkinSet      = new Set(checkinFieldCols);

  // Unique condition values for the filter dropdown
  const conditionValues = hasCondition
    ? [...new Set(metrics.map((m) => (m['Condition'] || '').trim()).filter(Boolean))].sort()
    : [];

  // Most-recent reading per participant
  const latestByPid = {};
  metrics.forEach((m) => {
    const pid = m['Subject ID'];
    if (!latestByPid[pid] || new Date(m['Date']) > new Date(latestByPid[pid]['Date'])) {
      latestByPid[pid] = m;
    }
  });
  const participantCount = Object.keys(latestByPid).length;

  // Only the non-check-in metric columns get stat cards
  const metricStatCols = displayCols.filter((k) => !checkinSet.has(k) && metricsSummary[k]);

  const filtered = metrics.filter((m) => {
    if (filterPid && !(m['Subject ID'] || '').toLowerCase().includes(filterPid.toLowerCase())) return false;
    if (filterCondition && (m['Condition'] || '').trim() !== filterCondition) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'date')    return new Date(b['Date']) - new Date(a['Date']);
    if (sortBy === 'subject') return (a['Subject ID'] || '').localeCompare(b['Subject ID'] || '');
    return (parseFloat(b[sortBy]) || 0) - (parseFloat(a[sortBy]) || 0);
  });

  if (metrics.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-slate-700 mb-1">No Daily Status data yet</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto">
          Once participants have Daily Status rows, all columns appear here — including any backend metrics
          (e.g. <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">AHI</code>, <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">Vibration</code>, <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">Condition</code>) you add to the tab.
          Columns in the <strong>Check-in Fields</strong> tab are already visible to participants; all others are admin-only.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Daily Status Data</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {metrics.length} row{metrics.length !== 1 ? 's' : ''} across {participantCount} participant{participantCount !== 1 ? 's' : ''} · {displayCols.length} column{displayCols.length !== 1 ? 's' : ''}
          </p>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-brand-400 inline-block" />
            Participant-visible
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />
            Admin-only
          </span>
        </div>
      </div>

      {/* Aggregate stat cards — only for non-check-in numeric columns */}
      {metricStatCols.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {metricStatCols.map((col) => {
            const stat = metricsSummary[col];
            return (
              <div key={col} className="bg-white rounded-2xl border border-slate-100 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 truncate">{col}</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Avg</span>
                    <span className="font-bold text-slate-800 font-mono">{stat.avg}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Min</span>
                    <span className="font-semibold text-emerald-600 font-mono">{stat.min}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Max</span>
                    <span className="font-semibold text-red-500 font-mono">{stat.max}</span>
                  </div>
                  <div className="flex justify-between text-xs pt-1 border-t border-slate-50">
                    <span className="text-slate-400">n</span>
                    <span className="text-slate-500 font-mono">{stat.count}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters row */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Filter by Subject ID…"
          value={filterPid}
          onChange={(e) => setFilterPid(e.target.value)}
          className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
        />
        {hasCondition && conditionValues.length > 0 && (
          <select
            value={filterCondition}
            onChange={(e) => setFilterCondition(e.target.value)}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
          >
            <option value="">All conditions</option>
            {conditionValues.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        )}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
        >
          <option value="date">Newest first</option>
          <option value="subject">Subject ID</option>
          {displayCols.filter((c) => metricsSummary[c]).map((col) => (
            <option key={col} value={col}>Highest {col}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          {/* Column headers */}
          <div
            className="grid gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100"
            style={{ gridTemplateColumns: `140px 100px${hasCondition ? ' 110px' : ''} ${displayCols.map(() => 'minmax(90px,1fr)').join(' ')}` }}
          >
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Subject ID</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</span>
            {hasCondition && (
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Condition</span>
            )}
            {displayCols.map((col) => (
              <div key={col} className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${checkinSet.has(col) ? 'bg-brand-400' : 'bg-slate-300'}`}
                  title={checkinSet.has(col) ? 'Visible to participants' : 'Admin-only'}
                />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide truncate">{col}</span>
              </div>
            ))}
          </div>

          {sorted.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">No rows match your filters.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {sorted.map((row, idx) => {
                const dateStr = row['Date']
                  ? (() => { try { return new Date(row['Date']).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }); } catch { return row['Date']; } })()
                  : '—';
                const condition = (row['Condition'] || '').trim();

                return (
                  <div
                    key={idx}
                    className="grid gap-3 px-5 py-3.5 hover:bg-slate-50 transition items-center"
                    style={{ gridTemplateColumns: `140px 100px${hasCondition ? ' 110px' : ''} ${displayCols.map(() => 'minmax(90px,1fr)').join(' ')}` }}
                  >
                    <a
                      href={`/dashboard/${encodeURIComponent(row['Subject ID'])}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-brand-600 hover:text-brand-700 hover:underline truncate"
                    >
                      {row['Subject ID']}
                    </a>
                    <span className="text-xs text-slate-500">{dateStr}</span>
                    {hasCondition && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full w-fit ${
                        condition
                          ? 'bg-slate-100 text-slate-600'
                          : 'text-slate-300'
                      }`}>
                        {condition || '—'}
                      </span>
                    )}
                    {displayCols.map((col) => {
                      const val = row[col];
                      const num = parseFloat(val);
                      const stat = metricsSummary[col];
                      let colorClass = 'text-slate-700';
                      if (stat && !isNaN(num)) {
                        const range = stat.max - stat.min;
                        if (range > 0) {
                          const pct = (num - stat.min) / range;
                          if (pct >= 0.85) colorClass = 'text-red-600 font-semibold';
                          else if (pct <= 0.15) colorClass = 'text-emerald-600';
                        }
                      }
                      // Check-in fields show as text badges (valid/invalid), metrics as numbers
                      const isCheckin = checkinSet.has(col);
                      const valLower  = (val || '').toString().toLowerCase().trim();
                      const isValid   = valLower === 'yes' || valLower === 'true' || valLower === 'complete' || valLower === 'valid' || valLower === 'pass';
                      const isBad     = valLower === 'no' || valLower === 'false' || valLower === 'incomplete' || valLower === 'invalid' || valLower === 'fail';

                      if (isCheckin && (isValid || isBad)) {
                        return (
                          <span key={col} className={`text-xs font-semibold px-2 py-0.5 rounded-full w-fit ${
                            isValid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                          }`}>
                            {isValid ? '✓' : '✗'} {val}
                          </span>
                        );
                      }

                      return (
                        <span key={col} className={`text-sm font-mono ${val ? colorClass : 'text-slate-300'}`}>
                          {val || '—'}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </div>
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
      className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_80px_80px] gap-4 px-5 py-4 hover:bg-slate-50 transition items-center"
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
        <span className="text-xs text-slate-500">{s.lastLogin || '—'}</span>
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

// ─── EligibilityChecker ───────────────────────────────────────────────────────

const OPERATORS   = ['>', '>=', '<', '<=', '='];
const MODES = [
  { value: 'average_all',    label: 'Average (all days)'    },
  { value: 'average_last_n', label: 'Average (last N days)' },
  { value: 'every_day',      label: 'Every day'             },
  { value: 'at_least_n',     label: 'At least N days'       },
  { value: 'any_day',        label: 'Any day'               },
];

function newCriterion() {
  return { id: `c${Date.now()}${Math.random().toString(36).slice(2,6)}`, column: '', operator: '>', threshold: '', mode: 'average_all', n: 3 };
}
function newScenario(name = 'New Scenario') {
  return { id: `s${Date.now()}${Math.random().toString(36).slice(2,6)}`, name, criteria: [newCriterion()] };
}

// Evaluate a single criterion against a participant's sorted rows (oldest→newest)
function evalCriterion(rows, criterion) {
  const { column, operator, threshold, mode, n } = criterion;
  const thresh = parseFloat(threshold);
  if (!column || isNaN(thresh)) return { pass: null, value: null, label: '—' };

  const vals = rows
    .map(r => parseFloat(r[column]))
    .filter(v => !isNaN(v));

  if (vals.length === 0) return { pass: null, value: null, label: 'no data' };

  const compare = (v) => {
    if (operator === '>')  return v >  thresh;
    if (operator === '>=') return v >= thresh;
    if (operator === '<')  return v <  thresh;
    if (operator === '<=') return v <= thresh;
    if (operator === '=')  return Math.abs(v - thresh) < 0.0001;
    return false;
  };

  if (mode === 'average_all') {
    const avg = vals.reduce((a,b) => a+b, 0) / vals.length;
    return { pass: compare(avg), value: avg, label: avg.toFixed(2) };
  }
  if (mode === 'average_last_n') {
    const slice = vals.slice(-Math.max(1, n));
    const avg = slice.reduce((a,b) => a+b, 0) / slice.length;
    return { pass: compare(avg), value: avg, label: `${avg.toFixed(2)} (last ${slice.length}d)` };
  }
  if (mode === 'every_day') {
    const pass = vals.every(compare);
    const pct  = Math.round(vals.filter(compare).length / vals.length * 100);
    return { pass, value: pct, label: `${vals.filter(compare).length}/${vals.length} days` };
  }
  if (mode === 'at_least_n') {
    const count = vals.filter(compare).length;
    const pass  = count >= Math.max(1, n);
    return { pass, value: count, label: `${count}/${vals.length} days` };
  }
  if (mode === 'any_day') {
    const count = vals.filter(compare).length;
    return { pass: count > 0, value: count, label: `${count}/${vals.length} days` };
  }
  return { pass: null, value: null, label: '—' };
}

// Evaluate all criteria for all participants — returns array of { pid, rows, results[], pass }
function evalScenario(metrics, criteria) {
  const byPid = {};
  metrics.forEach(r => {
    const pid = r['Subject ID'] || '?';
    if (!byPid[pid]) byPid[pid] = [];
    byPid[pid].push(r);
  });
  // Sort each participant's rows oldest→newest
  Object.values(byPid).forEach(rows => rows.sort((a,b) => new Date(a['Date']) - new Date(b['Date'])));

  return Object.entries(byPid).map(([pid, rows]) => {
    const results = criteria.map(c => ({ criterion: c, ...evalCriterion(rows, c) }));
    const evaluated = results.filter(r => r.pass !== null);
    const pass = evaluated.length === criteria.length && evaluated.length > 0 && evaluated.every(r => r.pass);
    const incomplete = evaluated.length < criteria.length;
    return { pid, rows, results, pass, incomplete };
  }).sort((a,b) => a.pid.localeCompare(b.pid));
}

function EligibilityChecker({ metrics, activeSlug }) {
  const STORAGE_KEY = `eligibility_scenarios_${activeSlug}`;

  // ── State ────────────────────────────────────────────────────────────────────
  const [scenarios,      setScenarios]      = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); return s?.length ? s : [newScenario('Protocol v1')]; }
    catch { return [newScenario('Protocol v1')]; }
  });
  const [activeScenId,   setActiveScenId]   = useState(() => scenarios[0]?.id || '');
  const [mode,           setMode]           = useState('single'); // 'single' | 'compare'
  const [compareA,       setCompareA]       = useState(() => scenarios[0]?.id || '');
  const [compareB,       setCompareB]       = useState(() => scenarios[1]?.id || scenarios[0]?.id || '');
  const [renamingId,     setRenamingId]     = useState(null);
  const [renameVal,      setRenameVal]      = useState('');

  // Persist on change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios)); } catch {}
  }, [scenarios, STORAGE_KEY]);

  // ── Numeric columns available in metrics ─────────────────────────────────────
  const numericCols = useMemo(() => {
    if (!metrics.length) return [];
    return Object.keys(metrics[0]).filter(k => {
      if (['Subject ID','Date','Condition','Acknowledgments','Tonight Checklist'].includes(k)) return false;
      const vals = metrics.map(r => r[k]).filter(v => v !== '' && v != null);
      return vals.length > 0 && vals.some(v => !isNaN(Number(v)));
    });
  }, [metrics]);

  // ── Scenario helpers ─────────────────────────────────────────────────────────
  const activeSeen = scenarios.find(s => s.id === activeScenId) || scenarios[0];

  function updateScenario(id, updater) {
    setScenarios(prev => prev.map(s => s.id === id ? { ...s, ...updater(s) } : s));
  }
  function addScenario() {
    const s = newScenario(`Scenario ${scenarios.length + 1}`);
    setScenarios(prev => [...prev, s]);
    setActiveScenId(s.id);
  }
  function duplicateScenario(id) {
    const src = scenarios.find(s => s.id === id);
    if (!src) return;
    const dup = { ...src, id: `s${Date.now()}`, name: `${src.name} (copy)`,
      criteria: src.criteria.map(c => ({ ...c, id: `c${Date.now()}${Math.random().toString(36).slice(2,6)}` })) };
    setScenarios(prev => [...prev, dup]);
    setActiveScenId(dup.id);
  }
  function deleteScenario(id) {
    if (scenarios.length <= 1) return;
    const next = scenarios.filter(s => s.id !== id);
    setScenarios(next);
    if (activeScenId === id) setActiveScenId(next[0]?.id || '');
    if (compareA === id) setCompareA(next[0]?.id || '');
    if (compareB === id) setCompareB(next[next.length-1]?.id || next[0]?.id || '');
  }

  // ── Criteria helpers for active scenario ────────────────────────────────────
  function addCriterion() {
    updateScenario(activeScenId, s => ({ criteria: [...s.criteria, newCriterion()] }));
  }
  function updateCriterion(scenId, critId, patch) {
    updateScenario(scenId, s => ({ criteria: s.criteria.map(c => c.id === critId ? { ...c, ...patch } : c) }));
  }
  function removeCriterion(critId) {
    updateScenario(activeScenId, s => ({ criteria: s.criteria.filter(c => c.id !== critId) }));
  }

  // ── Results computation ──────────────────────────────────────────────────────
  const activeResults = useMemo(() => {
    if (!activeSeen) return [];
    return evalScenario(metrics, activeSeen.criteria);
  }, [metrics, activeSeen]);

  const compareResultsA = useMemo(() => {
    const scen = scenarios.find(s => s.id === compareA);
    return scen ? evalScenario(metrics, scen.criteria) : [];
  }, [metrics, scenarios, compareA]);

  const compareResultsB = useMemo(() => {
    const scen = scenarios.find(s => s.id === compareB);
    return scen ? evalScenario(metrics, scen.criteria) : [];
  }, [metrics, scenarios, compareB]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const passCount    = activeResults.filter(r => r.pass).length;
  const failCount    = activeResults.filter(r => !r.pass && !r.incomplete).length;
  const incompleteCount = activeResults.filter(r => r.incomplete).length;

  function deltaLabel(aPass, bPass) {
    if (aPass && bPass)   return { label: '✓ Both',    color: 'bg-emerald-100 text-emerald-700' };
    if (aPass && !bPass)  return { label: '✓ A only',  color: 'bg-blue-100 text-blue-700' };
    if (!aPass && bPass)  return { label: '✓ B only',  color: 'bg-violet-100 text-violet-700' };
    return                       { label: '✗ Neither', color: 'bg-slate-100 text-slate-500' };
  }

  const swingCount = useMemo(() => {
    if (!compareResultsA.length || !compareResultsB.length) return 0;
    const mapB = Object.fromEntries(compareResultsB.map(r => [r.pid, r.pass]));
    return compareResultsA.filter(r => r.pass !== mapB[r.pid]).length;
  }, [compareResultsA, compareResultsB]);

  // ── Slack update generator ────────────────────────────────────────────────
  const [slackText,    setSlackText]    = useState('');
  const [slackCopied,  setSlackCopied]  = useState(false);

  function generateSlackUpdate() {
    const scen  = mode === 'single' ? activeSeen : null;
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const study = activeSlug ? activeSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Study';

    let lines = [];

    if (mode === 'single' && scen) {
      lines.push(`:clipboard: *Eligibility Update — ${study}*`);
      lines.push(`_${today} · Scenario: ${scen.name}_`);
      lines.push('');

      const total    = activeResults.length;
      const eligible = activeResults.filter(r => r.pass).length;
      const notElig  = activeResults.filter(r => !r.pass && !r.incomplete).length;
      const incomp   = activeResults.filter(r => r.incomplete).length;

      lines.push(`*${eligible} of ${total} participant${total !== 1 ? 's' : ''} eligible for phase advancement*`);
      lines.push('');

      // Per-participant
      activeResults.forEach(({ pid, rows, pass, incomplete, results }) => {
        const icon = incomplete ? ':warning:' : pass ? ':white_check_mark:' : ':x:';
        const status = incomplete ? 'Incomplete data' : pass ? 'Eligible' : 'Not eligible';
        const failing = results.filter(r => r.pass === false).map(r => r.criterion.column).join(', ');
        const detail = (!pass && !incomplete && failing) ? ` _(failed: ${failing})_` : '';
        lines.push(`${icon} *${pid}* — ${status}${detail} · ${rows.length} night${rows.length !== 1 ? 's' : ''}`);
      });

      lines.push('');
      lines.push('*Criteria:*');
      scen.criteria.forEach((c, i) => {
        const modeLabel = MODES.find(m => m.value === c.mode)?.label || c.mode;
        const nPart = (c.mode === 'average_last_n' || c.mode === 'at_least_n') ? `, N=${c.n}` : '';
        lines.push(`  ${i + 1}. ${c.column} ${c.operator} ${c.threshold}  _(${modeLabel}${nPart})_`);
      });

      if (incomp > 0) lines.push('', `_:warning: ${incomp} participant${incomp !== 1 ? 's' : ''} have incomplete data and could not be fully evaluated._`);

    } else if (mode === 'compare') {
      const scenA = scenarios.find(s => s.id === compareA);
      const scenB = scenarios.find(s => s.id === compareB);
      lines.push(`:bar_chart: *Eligibility Comparison — ${study}*`);
      lines.push(`_${today}_`);
      lines.push('');
      lines.push(`*Scenario A:* ${scenA?.name || '—'}   |   *Scenario B:* ${scenB?.name || '—'}`);
      lines.push('');

      const mapB = Object.fromEntries(compareResultsB.map(r => [r.pid, r]));
      const both  = compareResultsA.filter(r => r.pass && mapB[r.pid]?.pass);
      const aOnly = compareResultsA.filter(r => r.pass && !mapB[r.pid]?.pass);
      const bOnly = compareResultsA.filter(r => !r.pass && mapB[r.pid]?.pass);
      const neither = compareResultsA.filter(r => !r.pass && !mapB[r.pid]?.pass);

      lines.push(`*:white_check_mark: Eligible under both (${both.length}):* ${both.map(r => r.pid).join(', ') || '—'}`);
      lines.push(`*:large_blue_circle: A only (${aOnly.length}):* ${aOnly.map(r => r.pid).join(', ') || '—'}`);
      lines.push(`*:purple_circle: B only (${bOnly.length}):* ${bOnly.map(r => r.pid).join(', ') || '—'}`);
      lines.push(`*:x: Neither (${neither.length}):* ${neither.map(r => r.pid).join(', ') || '—'}`);
      if (swingCount > 0) lines.push('', `_:arrows_counterclockwise: ${swingCount} participant${swingCount !== 1 ? 's' : ''} change eligibility between scenarios._`);
    }

    setSlackText(lines.join('\n'));
    setSlackCopied(false);
  }

  function copySlack() {
    navigator.clipboard.writeText(slackText).then(() => {
      setSlackCopied(true);
      setTimeout(() => setSlackCopied(false), 2000);
    });
  }

  if (!metrics.length) {
    return <p className="text-sm text-slate-400 py-8 text-center">No Daily Status data yet — eligibility checks require participant data.</p>;
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Eligibility Checker</h2>
          <p className="text-xs text-slate-400 mt-0.5">Define criteria sets and see which participants qualify for phase advancement.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMode('single')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${mode === 'single' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'}`}>
            Single
          </button>
          <button onClick={() => setMode('compare')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${mode === 'compare' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'}`}>
            Compare
          </button>
          <button onClick={generateSlackUpdate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#4A154B] hover:bg-[#611f64] text-white transition">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.527 2.527 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.527 2.527 0 012.521 2.521 2.527 2.527 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.527 2.527 0 01-2.522 2.521h-2.522V8.834zM17.687 8.834a2.527 2.527 0 01-2.521 2.521 2.526 2.526 0 01-2.521-2.521V2.522A2.527 2.527 0 0115.166 0a2.528 2.528 0 012.521 2.522v6.312zM15.166 18.956a2.528 2.528 0 012.521 2.522A2.528 2.528 0 0115.166 24a2.527 2.527 0 01-2.521-2.522v-2.522h2.521zM15.166 17.687a2.527 2.527 0 01-2.521-2.521 2.527 2.527 0 012.521-2.521h6.312A2.528 2.528 0 0124 15.165a2.528 2.528 0 01-2.522 2.522h-6.312z"/>
            </svg>
            Slack update
          </button>
        </div>
      </div>

      {/* ── Scenario tabs ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">Scenarios</span>
          {scenarios.map(s => (
            <div key={s.id} className="relative group flex items-center">
              {renamingId === s.id ? (
                <input
                  autoFocus
                  value={renameVal}
                  onChange={e => setRenameVal(e.target.value)}
                  onBlur={() => { updateScenario(s.id, () => ({ name: renameVal || s.name })); setRenamingId(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') { updateScenario(s.id, () => ({ name: renameVal || s.name })); setRenamingId(null); } if (e.key === 'Escape') setRenamingId(null); }}
                  className="text-xs px-2 py-1 border border-violet-400 rounded-lg w-32 focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              ) : (
                <button
                  onClick={() => setActiveScenId(s.id)}
                  onDoubleClick={() => { setRenamingId(s.id); setRenameVal(s.name); }}
                  title="Click to select · Double-click to rename"
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition border ${
                    activeScenId === s.id
                      ? 'bg-violet-50 border-violet-300 text-violet-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}>
                  {s.name}
                </button>
              )}
              {/* Actions on hover */}
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:flex items-center gap-1 bg-white border border-slate-200 rounded-lg shadow-sm px-1 py-0.5 z-10">
                <button onClick={() => duplicateScenario(s.id)} title="Duplicate" className="p-1 hover:text-violet-600 text-slate-400 transition text-[10px]">⎘</button>
                {scenarios.length > 1 && (
                  <button onClick={() => deleteScenario(s.id)} title="Delete" className="p-1 hover:text-red-500 text-slate-400 transition text-[10px]">✕</button>
                )}
              </div>
            </div>
          ))}
          <button onClick={addScenario}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-violet-400 hover:text-violet-600 transition font-semibold">
            + New
          </button>
        </div>
        <p className="text-[10px] text-slate-400">Double-click a scenario name to rename it. Hover for duplicate/delete.</p>
      </div>

      {/* ── Criteria builder for active scenario ── */}
      {mode === 'single' && activeSeen && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-700">Criteria — {activeSeen.name}</h3>
            <button onClick={addCriterion}
              className="text-xs px-3 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg font-semibold transition border border-violet-200">
              + Add criterion
            </button>
          </div>

          {activeSeen.criteria.length === 0 && (
            <p className="text-xs text-slate-400 py-2">No criteria yet. Add one above.</p>
          )}

          <div className="space-y-2">
            {activeSeen.criteria.map((c, idx) => (
              <div key={c.id} className="grid grid-cols-[auto_1fr] gap-3 items-start">
                {/* Row number */}
                <span className="text-[10px] text-slate-400 font-mono pt-2.5 w-5 text-right">{idx+1}</span>
                {/* Criterion fields */}
                <div className="flex flex-wrap gap-2 items-center bg-slate-50 rounded-xl px-3 py-2">
                  {/* Column */}
                  <select value={c.column} onChange={e => updateCriterion(activeScenId, c.id, { column: e.target.value })}
                    className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 min-w-[140px]">
                    <option value="">— column —</option>
                    {numericCols.map(col => <option key={col} value={col}>{col}</option>)}
                  </select>
                  {/* Operator */}
                  <select value={c.operator} onChange={e => updateCriterion(activeScenId, c.id, { operator: e.target.value })}
                    className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 w-16">
                    {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                  </select>
                  {/* Threshold */}
                  <input type="number" value={c.threshold} onChange={e => updateCriterion(activeScenId, c.id, { threshold: e.target.value })}
                    placeholder="value"
                    className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 w-20" />
                  {/* Mode */}
                  <select value={c.mode} onChange={e => updateCriterion(activeScenId, c.id, { mode: e.target.value })}
                    className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300">
                    {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  {/* N input — only for modes that need it */}
                  {(c.mode === 'average_last_n' || c.mode === 'at_least_n') && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-500">N =</span>
                      <input type="number" min="1" value={c.n} onChange={e => updateCriterion(activeScenId, c.id, { n: parseInt(e.target.value) || 1 })}
                        className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 w-16" />
                    </div>
                  )}
                  {/* Remove */}
                  {activeSeen.criteria.length > 1 && (
                    <button onClick={() => removeCriterion(c.id)}
                      className="ml-auto text-slate-300 hover:text-red-400 transition p-1 rounded-lg hover:bg-red-50 text-xs">
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Compare mode: criteria editors side by side ── */}
      {mode === 'compare' && (
        <div className="grid grid-cols-2 gap-4">
          {[{ id: compareA, setId: setCompareA, label: 'A' }, { id: compareB, setId: setCompareB, label: 'B' }].map(({ id, setId, label }) => {
            const scen = scenarios.find(s => s.id === id) || scenarios[0];
            return (
              <div key={label} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${label === 'A' ? 'bg-blue-500' : 'bg-violet-500'}`}>{label}</span>
                  <select value={id} onChange={e => setId(e.target.value)}
                    className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 flex-1">
                    {scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                {scen && (
                  <div className="space-y-1.5">
                    {scen.criteria.map((c, idx) => (
                      <div key={c.id} className="text-xs bg-slate-50 rounded-lg px-3 py-2 flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                        <span className="text-slate-400 font-mono">{idx+1}.</span>
                        <span className="font-semibold text-slate-700">{c.column || '—'}</span>
                        <span className="text-slate-500">{c.operator}</span>
                        <span className="font-semibold text-slate-700">{c.threshold !== '' ? c.threshold : '—'}</span>
                        <span className="text-slate-400 ml-1">({MODES.find(m => m.value === c.mode)?.label}{(c.mode === 'average_last_n' || c.mode === 'at_least_n') ? `, N=${c.n}` : ''})</span>
                      </div>
                    ))}
                    {scen.criteria.length === 0 && <p className="text-xs text-slate-400">No criteria.</p>}
                  </div>
                )}
                <button onClick={() => { setActiveScenId(id); setMode('single'); }}
                  className="text-[10px] text-violet-500 hover:text-violet-700 transition">
                  Edit this scenario →
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Summary bar ── */}
      {mode === 'single' && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Eligible',    count: passCount,       color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
            { label: 'Not eligible', count: failCount,      color: 'bg-red-50 border-red-200 text-red-600' },
            { label: 'Incomplete',  count: incompleteCount, color: 'bg-amber-50 border-amber-200 text-amber-600' },
          ].map(({ label, count, color }) => (
            <div key={label} className={`rounded-xl border px-4 py-3 text-center ${color}`}>
              <div className="text-2xl font-bold">{count}</div>
              <div className="text-xs font-medium mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {mode === 'compare' && compareResultsA.length > 0 && compareResultsB.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {(() => {
            const mapB = Object.fromEntries(compareResultsB.map(r => [r.pid, r.pass]));
            const aa = compareResultsA.filter(r => r.pass && mapB[r.pid]).length;
            const ab = compareResultsA.filter(r => r.pass && !mapB[r.pid]).length;
            const ba = compareResultsA.filter(r => !r.pass && mapB[r.pid]).length;
            const nn = compareResultsA.filter(r => !r.pass && !mapB[r.pid]).length;
            return [
              { label: '✓ Both',    count: aa, color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
              { label: '✓ A only',  count: ab, color: 'bg-blue-50 border-blue-200 text-blue-700' },
              { label: '✓ B only',  count: ba, color: 'bg-violet-50 border-violet-200 text-violet-700' },
              { label: '✗ Neither', count: nn, color: 'bg-slate-50 border-slate-200 text-slate-500' },
            ].map(({ label, count, color }) => (
              <div key={label} className={`rounded-xl border px-4 py-3 text-center ${color}`}>
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-xs font-medium mt-0.5">{label}</div>
              </div>
            ));
          })()}
        </div>
      )}

      {mode === 'compare' && swingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-700 font-medium">
          ⚠️ {swingCount} participant{swingCount !== 1 ? 's' : ''} change eligibility between the two scenarios — review them below.
        </div>
      )}

      {/* ── Slack output panel ── */}
      {slackText && (
        <div className="bg-[#1a1d21] rounded-2xl border border-slate-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.527 2.527 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.527 2.527 0 012.521 2.521 2.527 2.527 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.527 2.527 0 01-2.522 2.521h-2.522V8.834zM17.687 8.834a2.527 2.527 0 01-2.521 2.521 2.526 2.526 0 01-2.521-2.521V2.522A2.527 2.527 0 0115.166 0a2.528 2.528 0 012.521 2.522v6.312zM15.166 18.956a2.528 2.528 0 012.521 2.522A2.528 2.528 0 0115.166 24a2.527 2.527 0 01-2.521-2.522v-2.522h2.521zM15.166 17.687a2.527 2.527 0 01-2.521-2.521 2.527 2.527 0 012.521-2.521h6.312A2.528 2.528 0 0124 15.165a2.528 2.528 0 01-2.522 2.522h-6.312z"/>
              </svg>
              <span className="text-xs font-semibold text-white/80">Slack message ready</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={copySlack}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${slackCopied ? 'bg-emerald-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
                {slackCopied ? '✓ Copied!' : 'Copy'}
              </button>
              <button onClick={() => setSlackText('')}
                className="text-white/30 hover:text-white/60 transition text-xs px-2 py-1.5">✕</button>
            </div>
          </div>
          <textarea
            readOnly
            value={slackText}
            rows={Math.min(20, slackText.split('\n').length + 1)}
            className="w-full bg-[#222529] text-[#d1d2d3] text-xs font-mono rounded-xl px-3 py-2.5 border border-white/10 focus:outline-none resize-none leading-relaxed"
          />
          <p className="text-[10px] text-white/30">Slack renders *bold*, _italic_, and :emoji: codes automatically.</p>
        </div>
      )}

      {/* ── Results table — single mode ── */}
      {mode === 'single' && activeSeen && activeResults.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 sticky left-0 bg-slate-50">Participant</th>
                  <th className="text-center px-3 py-3 font-semibold text-slate-600">Nights</th>
                  {activeSeen.criteria.map((c, i) => (
                    <th key={c.id} className="text-center px-3 py-3 font-semibold text-slate-600 min-w-[120px]">
                      <div className="text-slate-700">{c.column || `Rule ${i+1}`}</div>
                      <div className="text-slate-400 font-normal">{c.operator} {c.threshold} · {MODES.find(m=>m.value===c.mode)?.label}{(c.mode==='average_last_n'||c.mode==='at_least_n')?`, N=${c.n}`:''}</div>
                    </th>
                  ))}
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 sticky right-0 bg-slate-50">Status</th>
                </tr>
              </thead>
              <tbody>
                {activeResults.map(({ pid, rows, results, pass, incomplete }) => (
                  <tr key={pid} className={`border-b border-slate-50 hover:bg-slate-50 transition ${pass ? 'bg-emerald-50/30' : ''}`}>
                    <td className="px-4 py-3 font-semibold text-slate-800 sticky left-0 bg-inherit">{pid}</td>
                    <td className="px-3 py-3 text-center text-slate-500">{rows.length}</td>
                    {results.map(r => (
                      <td key={r.criterion.id} className="px-3 py-3 text-center">
                        {r.pass === null ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${r.pass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                              {r.pass ? '✓' : '✗'}
                            </span>
                            <span className="text-[10px] text-slate-400">{r.label}</span>
                          </div>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center sticky right-0 bg-inherit">
                      {incomplete ? (
                        <span className="inline-block px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-semibold text-[10px]">Incomplete</span>
                      ) : pass ? (
                        <span className="inline-block px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-semibold text-[10px]">✓ Eligible</span>
                      ) : (
                        <span className="inline-block px-2 py-1 rounded-full bg-red-100 text-red-600 font-semibold text-[10px]">✗ Not eligible</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Results table — compare mode ── */}
      {mode === 'compare' && compareResultsA.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Participant</th>
                  <th className="text-center px-3 py-3 font-semibold text-slate-600">Nights</th>
                  <th className="text-center px-3 py-3 font-semibold text-blue-600">
                    <span className="w-4 h-4 rounded-full bg-blue-500 text-white inline-flex items-center justify-center text-[10px] font-bold mr-1">A</span>
                    {scenarios.find(s => s.id === compareA)?.name || 'Scenario A'}
                  </th>
                  <th className="text-center px-3 py-3 font-semibold text-violet-600">
                    <span className="w-4 h-4 rounded-full bg-violet-500 text-white inline-flex items-center justify-center text-[10px] font-bold mr-1">B</span>
                    {scenarios.find(s => s.id === compareB)?.name || 'Scenario B'}
                  </th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600">Delta</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const mapB = Object.fromEntries(compareResultsB.map(r => [r.pid, r]));
                  return compareResultsA.map(rA => {
                    const rB = mapB[rA.pid];
                    const isSwing = rB && rA.pass !== rB.pass;
                    const { label: dLabel, color: dColor } = deltaLabel(rA.pass, rB?.pass ?? false);
                    return (
                      <tr key={rA.pid} className={`border-b border-slate-50 hover:bg-slate-50 transition ${isSwing ? 'bg-amber-50/40' : ''}`}>
                        <td className="px-4 py-3 font-semibold text-slate-800">
                          {rA.pid}
                          {isSwing && <span className="ml-2 text-[9px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full font-bold">swing</span>}
                        </td>
                        <td className="px-3 py-3 text-center text-slate-500">{rA.rows.length}</td>
                        <td className="px-3 py-3 text-center">
                          {rA.incomplete
                            ? <span className="text-amber-500 font-semibold">Incomplete</span>
                            : rA.pass
                            ? <span className="text-emerald-600 font-semibold">✓ Eligible</span>
                            : <span className="text-red-500 font-semibold">✗ No</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {!rB ? <span className="text-slate-300">—</span>
                            : rB.incomplete
                            ? <span className="text-amber-500 font-semibold">Incomplete</span>
                            : rB.pass
                            ? <span className="text-emerald-600 font-semibold">✓ Eligible</span>
                            : <span className="text-red-500 font-semibold">✗ No</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {rB && <span className={`inline-block px-2 py-1 rounded-full font-semibold text-[10px] ${dColor}`}>{dLabel}</span>}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
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
