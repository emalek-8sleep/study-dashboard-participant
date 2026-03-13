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
import { useState, useRef, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend,
  ScatterChart, Scatter, ReferenceLine,
} from 'recharts';

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
              { key: 'overview', label: 'Overview' },
              { key: 'data',     label: `Data${metrics.length > 0 ? ` (${metrics.length})` : ''}` },
              { key: 'analysis', label: 'Analysis' },
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

          {/* ── ANALYSIS TAB ── */}
          {activeTab === 'analysis' && (
            <AnalysisSection
              summaries={summaries}
              metrics={metrics}
              stats={stats}
              checkinFieldCols={checkinFieldCols}
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

// ─── AnalysisSection (sub-nav shell) ─────────────────────────────────────────

const ANALYSIS_SUBNAV_KEY = (slug) => `analysis_subnav_${slug}`;

function AnalysisSection({ summaries, metrics, stats, checkinFieldCols, activeSlug }) {
  const [subTab, setSubTab] = useState(() => {
    try { return localStorage.getItem(ANALYSIS_SUBNAV_KEY(activeSlug)) || 'charts'; } catch { return 'charts'; }
  });

  function switchSubTab(key) {
    setSubTab(key);
    try { localStorage.setItem(ANALYSIS_SUBNAV_KEY(activeSlug), key); } catch {}
  }

  const subTabs = [
    { key: 'charts',    label: 'Charts' },
    { key: 'plan',      label: 'Plan Generator' },
    { key: 'run',       label: 'Run Analysis' },
    { key: 'history',   label: 'History' },
  ];

  return (
    <div className="space-y-5">
      {/* Sub-nav */}
      <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-100 px-2 py-1.5 w-fit">
        {subTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => switchSubTab(t.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              subTab === t.key
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      {subTab === 'charts' && (
        <AnalysisView summaries={summaries} metrics={metrics} stats={stats} activeSlug={activeSlug} />
      )}
      {subTab === 'plan' && (
        <AnalysisPlanGenerator metrics={metrics} summaries={summaries} checkinFieldCols={checkinFieldCols} activeSlug={activeSlug} />
      )}
      {subTab === 'run' && (
        <AnalysisRunner metrics={metrics} summaries={summaries} checkinFieldCols={checkinFieldCols} activeSlug={activeSlug} />
      )}
      {subTab === 'history' && (
        <AnalysisHistory activeSlug={activeSlug} />
      )}
    </div>
  );
}

// ─── AnalysisPlanGenerator ────────────────────────────────────────────────────

const INTERNAL_PLAN_COLS = new Set(['Subject ID', 'Date', 'Acknowledgments', 'Tonight Checklist']);
const SD_THRESHOLDS = [2, 2.5, 3];
const SD_COLORS     = { 2: '#ef4444', 2.5: '#f97316', 3: '#eab308' };

function computeDescriptives(values) {
  const nums = values.map(Number).filter(v => !isNaN(v));
  if (!nums.length) return null;
  const n    = nums.length;
  const mean = nums.reduce((a, b) => a + b, 0) / n;
  const variance = nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const sd   = Math.sqrt(variance);
  const sorted = [...nums].sort((a, b) => a - b);
  const median = n % 2 === 0 ? (sorted[n/2-1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
  return { n, mean: +mean.toFixed(3), sd: +sd.toFixed(3), median: +median.toFixed(3),
    min: +sorted[0].toFixed(3), max: +sorted[n-1].toFixed(3) };
}

function AnalysisPlanGenerator({ metrics, summaries, checkinFieldCols, activeSlug }) {
  const [step,         setStep]         = useState(1);
  const [form,         setForm]         = useState({
    design: '', iv: '', dv: [], conditions: '', covariates: '',
    primaryOutcome: '', secondaryOutcomes: '', hypothesis: '', notes: '',
  });
  const [generating,   setGenerating]   = useState(false);
  const [plan,         setPlan]         = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [sdThreshold,  setSdThreshold]  = useState(2);
  const [removedPoints, setRemovedPoints] = useState({}); // { "colName|condition|subjectId|date": true }

  // Derive available numeric columns from metrics
  const allCols = metrics.length > 0
    ? Object.keys(metrics[0]).filter(k => !INTERNAL_PLAN_COLS.has(k) && k !== 'Condition')
    : [];
  const numericCols = allCols.filter(col => {
    const vals = metrics.map(r => r[col]).filter(v => v !== '' && v != null);
    return vals.length > 0 && vals.some(v => !isNaN(Number(v)));
  });

  // Conditions from data
  const conditions = [...new Set(metrics.map(r => (r['Condition'] || '').trim()).filter(Boolean))].sort();
  const hasConditions = conditions.length > 0;

  // DVs to analyse = form.dv if set, else all numeric cols
  const analysedDVs = form.dv.length > 0 ? form.dv : numericCols.slice(0, 6);

  // ── Descriptive stats & outlier computation ─────────────────────────────
  // Compute per-DV per-condition descriptives and flag outliers
  const descriptivesByVar = {};
  analysedDVs.forEach(col => {
    descriptivesByVar[col] = {};
    const condList = hasConditions ? conditions : ['All'];
    condList.forEach(cond => {
      const rows = metrics.filter(r =>
        !hasConditions || (r['Condition'] || '').trim() === cond
      );
      const vals = rows.map(r => ({ val: Number(r[col]), subjectId: r['Subject ID'], date: (r['Date'] || '').toString().split('T')[0], raw: r[col] }))
                       .filter(d => !isNaN(d.val) && d.raw !== '' && d.raw != null);
      const stats = computeDescriptives(vals.map(d => d.val));
      const outliers = {};
      SD_THRESHOLDS.forEach(sd => {
        if (!stats) return;
        outliers[sd] = vals.filter(d => Math.abs(d.val - stats.mean) > sd * stats.sd);
      });
      descriptivesByVar[col][cond] = { stats, vals, outliers };
    });
  });

  // Removed points → filtered datasets for downstream use
  function isRemoved(col, cond, subjectId, date) {
    return !!removedPoints[`${col}|${cond}|${subjectId}|${date}`];
  }
  function toggleRemove(col, cond, subjectId, date) {
    const key = `${col}|${cond}|${subjectId}|${date}`;
    setRemovedPoints(prev => ({ ...prev, [key]: !prev[key] }));
  }
  const totalRemoved = Object.values(removedPoints).filter(Boolean).length;

  function updateForm(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }
  function toggleDV(col) {
    setForm(prev => ({
      ...prev,
      dv: prev.dv.includes(col) ? prev.dv.filter(c => c !== col) : [...prev.dv, col],
    }));
  }

  async function generatePlan() {
    setGenerating(true);
    setPlan(null);
    try {
      const res  = await fetch('/api/analysis/generate-plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formData: { ...form, dv: analysedDVs.join(', ') },
          availableColumns: numericCols,
          studyData: { n: summaries.length, conditions, dateRange: metrics.length > 0
            ? `${metrics[metrics.length-1]?.['Date']?.toString().split('T')[0]} to ${metrics[0]?.['Date']?.toString().split('T')[0]}` : 'N/A' },
          referenceDAPs: [],
        }),
      });
      const data = await res.json();
      if (data.plan) { setPlan(data.plan); setStep(4); }
      else throw new Error(data.error || 'Generation failed');
    } catch (err) {
      alert('Error generating plan: ' + err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function savePlan() {
    setSaving(true);
    try {
      const res  = await fetch('/api/analysis/save-plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, formData: form, activeSlug }),
      });
      const data = await res.json();
      if (data.success) setSaved(true);
      else throw new Error(data.error);
    } catch (err) {
      alert('Error saving plan: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  const STEP_LABELS = ['Variables & Design', 'Outcomes & Hypotheses', 'Descriptive Review', 'Analysis Plan'];

  return (
    <div className="space-y-5">

      {/* Step progress */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center gap-0">
          {STEP_LABELS.map((label, i) => {
            const n = i + 1;
            const active = step === n;
            const done   = step > n || (n === 4 && plan);
            return (
              <div key={n} className="flex items-center flex-1">
                <button
                  onClick={() => (done || active) && setStep(n)}
                  className={`flex items-center gap-2 text-xs font-semibold transition ${
                    active ? 'text-violet-600' : done ? 'text-emerald-600 cursor-pointer' : 'text-slate-400'
                  }`}
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    active ? 'bg-violet-600 text-white' : done ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
                  }`}>{done && !active ? '✓' : n}</span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
                {i < STEP_LABELS.length - 1 && <div className={`flex-1 h-px mx-2 ${step > n ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── STEP 1: Variables & Design ── */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-5">
          <h3 className="text-sm font-semibold text-slate-800">Step 1 — Variables & Study Design</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Study Design</label>
              <select value={form.design} onChange={e => updateForm('design', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                <option value="">Select…</option>
                <option value="crossover">Crossover (within-subjects)</option>
                <option value="pre-post">Pre-Post (within-subjects)</option>
                <option value="between-subjects">Between-subjects (parallel groups)</option>
                <option value="mixed">Mixed design (between + within)</option>
                <option value="longitudinal">Longitudinal / repeated measures</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Independent Variable (IV)</label>
              <input value={form.iv} onChange={e => updateForm('iv', e.target.value)}
                placeholder="e.g. Condition (Baseline vs Treatment)"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Dependent Variables (DVs) — select all that apply
            </label>
            {numericCols.length === 0 ? (
              <p className="text-xs text-slate-400">No numeric columns found in Daily Status data.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {numericCols.map(col => (
                  <button key={col} onClick={() => toggleDV(col)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                      form.dv.includes(col)
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
                    }`}>{col}</button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Conditions / Groups {hasConditions && <span className="text-violet-500">(auto-detected: {conditions.join(', ')})</span>}
              </label>
              <input value={form.conditions} onChange={e => updateForm('conditions', e.target.value)}
                placeholder={hasConditions ? conditions.join(', ') : 'e.g. Baseline, Treatment, Washout'}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Covariates (optional)</label>
              <input value={form.covariates} onChange={e => updateForm('covariates', e.target.value)}
                placeholder="e.g. Age, BMI, Baseline HRV"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={() => setStep(2)} disabled={!form.design || !form.iv}
              className="px-5 py-2 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 disabled:opacity-40 transition">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Outcomes & Hypotheses ── */}
      {step === 2 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-5">
          <h3 className="text-sm font-semibold text-slate-800">Step 2 — Outcomes & Hypotheses</h3>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Primary Outcome</label>
            <input value={form.primaryOutcome} onChange={e => updateForm('primaryOutcome', e.target.value)}
              placeholder="e.g. HRV improvement from Baseline to Treatment condition"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Secondary Outcomes (comma-separated)</label>
            <input value={form.secondaryOutcomes} onChange={e => updateForm('secondaryOutcomes', e.target.value)}
              placeholder="e.g. RHR reduction, Sleep Score, Wesper AHI"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Hypothesis</label>
            <textarea value={form.hypothesis} onChange={e => updateForm('hypothesis', e.target.value)} rows={3}
              placeholder="e.g. We hypothesize that HRV will be significantly higher in the Treatment condition compared to Baseline (directional)."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Additional Notes</label>
            <textarea value={form.notes} onChange={e => updateForm('notes', e.target.value)} rows={2}
              placeholder="Any exclusion criteria, known data quality issues, or analysis-specific context…"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="px-5 py-2 text-slate-500 text-sm font-semibold hover:text-slate-700 transition">← Back</button>
            <button onClick={() => setStep(3)} disabled={!form.primaryOutcome}
              className="px-5 py-2 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 disabled:opacity-40 transition">
              Review Data →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Descriptive Stats & Outlier Detection ── */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Controls bar */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-wrap items-center gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-700">Descriptive Statistics & Outlier Detection</p>
              <p className="text-xs text-slate-400">Outliers are flagged and can be excluded per condition before running the analysis.</p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-slate-500 font-medium">Outlier threshold:</span>
              {SD_THRESHOLDS.map(sd => (
                <button key={sd} onClick={() => setSdThreshold(sd)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    sdThreshold === sd ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}>
                  {sd} SD
                </button>
              ))}
              {totalRemoved > 0 && (
                <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2.5 py-1 rounded-full">
                  {totalRemoved} point{totalRemoved !== 1 ? 's' : ''} excluded
                </span>
              )}
            </div>
          </div>

          {/* Per-variable sections */}
          {analysedDVs.map(col => (
            <div key={col} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">{col}</span>
                {Object.values(descriptivesByVar[col] || {}).some(c =>
                  (c.outliers[sdThreshold] || []).length > 0
                ) && (
                  <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full ml-auto">
                    ⚠ outliers at {sdThreshold} SD
                  </span>
                )}
              </div>

              <div className="p-5 space-y-4">
                {/* Descriptive stats table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-400 font-semibold uppercase tracking-wide border-b border-slate-100">
                        <th className="pb-2 pr-4">Condition</th>
                        <th className="pb-2 pr-4">N</th>
                        <th className="pb-2 pr-4">Mean</th>
                        <th className="pb-2 pr-4">SD</th>
                        <th className="pb-2 pr-4">Median</th>
                        <th className="pb-2 pr-4">Min</th>
                        <th className="pb-2 pr-4">Max</th>
                        <th className="pb-2">Outliers ({sdThreshold} SD)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {Object.entries(descriptivesByVar[col] || {}).map(([cond, { stats: s, outliers }]) => (
                        <tr key={cond} className="text-slate-600">
                          <td className="py-2 pr-4 font-medium text-slate-700">{cond}</td>
                          <td className="py-2 pr-4">{s?.n ?? '—'}</td>
                          <td className="py-2 pr-4">{s?.mean ?? '—'}</td>
                          <td className="py-2 pr-4">{s?.sd ?? '—'}</td>
                          <td className="py-2 pr-4">{s?.median ?? '—'}</td>
                          <td className="py-2 pr-4">{s?.min ?? '—'}</td>
                          <td className="py-2 pr-4">{s?.max ?? '—'}</td>
                          <td className="py-2">
                            {(outliers[sdThreshold] || []).length > 0 ? (
                              <span className="font-semibold" style={{ color: SD_COLORS[sdThreshold] }}>
                                {(outliers[sdThreshold] || []).length} flagged
                              </span>
                            ) : (
                              <span className="text-emerald-500">✓ None</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Chart with SD bands */}
                <OutlierChart
                  col={col}
                  descriptivesByVar={descriptivesByVar}
                  sdThreshold={sdThreshold}
                  conditions={hasConditions ? conditions : ['All']}
                  removedPoints={removedPoints}
                  onToggleRemove={toggleRemove}
                />

                {/* Flagged points list with remove toggles */}
                {Object.entries(descriptivesByVar[col] || {}).map(([cond, { outliers }]) => {
                  const flagged = (outliers[sdThreshold] || []).filter(d => !isRemoved(col, cond, d.subjectId, d.date));
                  const removed = (outliers[sdThreshold] || []).filter(d =>  isRemoved(col, cond, d.subjectId, d.date));
                  if ((outliers[sdThreshold] || []).length === 0) return null;
                  return (
                    <div key={cond} className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                      <p className="text-xs font-semibold text-amber-700 mb-2">
                        {cond} — {(outliers[sdThreshold] || []).length} outlier{(outliers[sdThreshold] || []).length !== 1 ? 's' : ''} at {sdThreshold} SD
                      </p>
                      <div className="space-y-1.5">
                        {(outliers[sdThreshold] || []).map(d => {
                          const removed = isRemoved(col, cond, d.subjectId, d.date);
                          return (
                            <div key={`${d.subjectId}-${d.date}`}
                              className={`flex items-center gap-3 text-xs px-3 py-2 rounded-lg transition ${
                                removed ? 'bg-slate-100 opacity-50' : 'bg-white border border-amber-200'
                              }`}>
                              <span className="font-mono font-semibold text-slate-700 w-12 shrink-0">{d.subjectId}</span>
                              <span className="text-slate-400 shrink-0">{d.date}</span>
                              <span className="font-semibold text-slate-800">{col} = {d.val.toFixed(3)}</span>
                              <button
                                onClick={() => toggleRemove(col, cond, d.subjectId, d.date)}
                                className={`ml-auto px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                                  removed
                                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                    : 'bg-red-100 text-red-600 hover:bg-red-200'
                                }`}>
                                {removed ? '+ Restore' : '× Exclude'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="px-5 py-2 text-slate-500 text-sm font-semibold hover:text-slate-700 transition">← Back</button>
            <button onClick={generatePlan} disabled={generating}
              className="px-6 py-2 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 transition flex items-center gap-2">
              {generating ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generating plan…</>
              ) : 'Generate Analysis Plan →'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Generated Plan ── */}
      {step === 4 && plan && (
        <div className="space-y-4">
          {/* Recommended tests */}
          {plan.recommendedTests?.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Recommended Statistical Tests</h3>
              <div className="space-y-3">
                {plan.recommendedTests.map((t, i) => (
                  <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-start gap-3">
                      <span className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-800">{t.test}</span>
                          {t.software && <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-mono">{t.software}</span>}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{t.rationale}</p>
                        {t.variables && (
                          <div className="flex gap-3 mt-1.5 flex-wrap">
                            {t.variables.outcome  && <span className="text-xs text-slate-400">Outcome: <strong className="text-slate-600">{t.variables.outcome}</strong></span>}
                            {t.variables.predictor && <span className="text-xs text-slate-400">Predictor: <strong className="text-slate-600">{t.variables.predictor}</strong></span>}
                            {t.variables.covariates && <span className="text-xs text-slate-400">Covariates: <strong className="text-slate-600">{t.variables.covariates}</strong></span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assumption tests */}
          {plan.assumptionTests?.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Required Assumption Tests</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400 font-semibold uppercase tracking-wide border-b border-slate-100">
                      <th className="pb-2 pr-4">Test</th>
                      <th className="pb-2 pr-4">Variable</th>
                      <th className="pb-2 pr-4">Pass Threshold</th>
                      <th className="pb-2">If Violated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {plan.assumptionTests.map((t, i) => (
                      <tr key={i} className="text-slate-600">
                        <td className="py-2 pr-4 font-semibold text-slate-700">{t.test}</td>
                        <td className="py-2 pr-4">{t.variable}</td>
                        <td className="py-2 pr-4 text-emerald-600">{t.threshold}</td>
                        <td className="py-2 text-amber-600">{t.failAction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {plan.effectSizes && (
              <div className="bg-white rounded-xl border border-slate-100 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Effect Sizes</p>
                <p className="text-sm text-slate-700">{plan.effectSizes}</p>
              </div>
            )}
            {plan.multipleComparisons && (
              <div className="bg-white rounded-xl border border-slate-100 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Multiple Comparisons</p>
                <p className="text-sm text-slate-700">{plan.multipleComparisons}</p>
              </div>
            )}
            {plan.powerConsiderations && (
              <div className="bg-white rounded-xl border border-slate-100 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Power</p>
                <p className="text-sm text-slate-700">{plan.powerConsiderations}</p>
              </div>
            )}
          </div>

          {/* Full markdown plan */}
          {plan.planMarkdown && (
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Full Analysis Plan</h3>
              <div className="prose prose-sm max-w-none text-slate-600 bg-slate-50 rounded-xl p-4 text-xs leading-relaxed whitespace-pre-wrap font-mono overflow-x-auto max-h-96 overflow-y-auto">
                {plan.planMarkdown}
              </div>
            </div>
          )}

          {/* Exclusion summary */}
          {totalRemoved > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="text-sm font-semibold text-amber-800 mb-1">
                {totalRemoved} data point{totalRemoved !== 1 ? 's' : ''} marked for exclusion
              </p>
              <p className="text-xs text-amber-600">These exclusions are based on condition-level outlier detection and will be applied when running the analysis.</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 justify-between">
            <button onClick={() => setStep(3)} className="px-5 py-2 text-slate-500 text-sm font-semibold hover:text-slate-700 transition">← Back</button>
            <div className="flex gap-3">
              <button onClick={() => { setPlan(null); setStep(1); setSaved(false); }}
                className="px-5 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition">
                Start Over
              </button>
              <button onClick={savePlan} disabled={saving || saved}
                className="px-6 py-2 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 transition">
                {saved ? '✓ Saved to Sheet' : saving ? 'Saving…' : 'Save Plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── OutlierChart ─────────────────────────────────────────────────────────────
// Scatter chart showing all data points with SD band overlays per condition

function OutlierChart({ col, descriptivesByVar, sdThreshold, conditions, removedPoints, onToggleRemove }) {
  const CONDITION_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'];

  // Build unified chart data: one entry per data point with condition colour
  const chartData = [];
  conditions.forEach((cond, ci) => {
    const info = (descriptivesByVar[col] || {})[cond];
    if (!info) return;
    const { vals, stats: s, outliers } = info;
    const flaggedIds = new Set((outliers[sdThreshold] || []).map(d => `${d.subjectId}|${d.date}`));
    vals.forEach((d, i) => {
      const key      = `${col}|${cond}|${d.subjectId}|${d.date}`;
      const isOut    = flaggedIds.has(`${d.subjectId}|${d.date}`);
      const isExcl   = !!removedPoints[key];
      chartData.push({
        x:         i + ci * 0.2, // slight x-offset per condition for visibility
        y:         d.val,
        subjectId: d.subjectId,
        date:      d.date,
        condition: cond,
        isOutlier: isOut,
        isExcluded:isExcl,
        fill: isExcl ? '#94a3b8' : isOut ? SD_COLORS[sdThreshold] : CONDITION_COLORS[ci % CONDITION_COLORS.length],
        mean:  s?.mean,
        sd:    s?.sd,
        upper2:  s ? s.mean + 2    * s.sd : null,
        lower2:  s ? s.mean - 2    * s.sd : null,
        upper25: s ? s.mean + 2.5  * s.sd : null,
        lower25: s ? s.mean - 2.5  * s.sd : null,
        upper3:  s ? s.mean + 3    * s.sd : null,
        lower3:  s ? s.mean - 3    * s.sd : null,
      });
    });
  });

  // Reference lines per condition for mean and SD bands
  const refLines = [];
  conditions.forEach((cond, ci) => {
    const info = (descriptivesByVar[col] || {})[cond];
    if (!info?.stats) return;
    const { mean, sd } = info.stats;
    SD_THRESHOLDS.forEach(t => {
      refLines.push({ y: mean + t * sd, stroke: SD_COLORS[t], dash: '4 2', label: `${cond} +${t}σ` });
      refLines.push({ y: mean - t * sd, stroke: SD_COLORS[t], dash: '4 2', label: `${cond} -${t}σ` });
    });
    refLines.push({ y: mean, stroke: CONDITION_COLORS[ci % CONDITION_COLORS.length], dash: '0', label: `${cond} mean` });
  });

  return (
    <div>
      <p className="text-xs text-slate-400 mb-2">
        Each dot = one data point. Click a flagged dot to exclude/restore it.
        <span className="ml-2">
          {SD_THRESHOLDS.map(t => (
            <span key={t} className="mr-3 inline-flex items-center gap-1">
              <span className="w-3 h-0.5 inline-block" style={{ background: SD_COLORS[t] }} />
              <span>{t}σ band</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1 text-slate-400">
            <span className="w-3 h-0.5 inline-block bg-slate-300" />
            excluded
          </span>
        </span>
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 8, right: 16, left: -20, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="x" type="number" tick={false} axisLine={false} tickLine={false} label={{ value: 'Data points', position: 'insideBottom', fontSize: 10, fill: '#94a3b8' }} />
          <YAxis dataKey="y" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs">
                  <p className="font-semibold text-slate-700">{d.subjectId} · {d.date}</p>
                  <p className="text-slate-500">{d.condition}: <strong>{d.y?.toFixed(3)}</strong></p>
                  {d.isOutlier && <p className="text-red-500 font-semibold">⚠ Outlier at {sdThreshold}σ</p>}
                  {d.isExcluded && <p className="text-slate-400">Excluded from analysis</p>}
                </div>
              );
            }}
          />
          <Scatter
            data={chartData}
            onClick={(d) => d.isOutlier && onToggleRemove(col, d.condition, d.subjectId, d.date)}
          >
            {chartData.map((d, i) => (
              <Cell
                key={i}
                fill={d.fill}
                opacity={d.isExcluded ? 0.3 : 0.85}
                cursor={d.isOutlier ? 'pointer' : 'default'}
              />
            ))}
          </Scatter>
          {/* SD reference lines via recharts ReferenceLine */}
          {refLines.map((r, i) => (
            <ReferenceLine key={i} y={r.y} stroke={r.stroke} strokeDasharray={r.dash} strokeWidth={1} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── AnalysisRunner ───────────────────────────────────────────────────────────

// Simple markdown → HTML for interpretation panel (headings, bold, bullets)
function renderMarkdown(md) {
  if (!md) return '';
  return md
    .replace(/^## (.+)$/gm, '<h3 class="text-sm font-semibold text-slate-800 mt-5 mb-1">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 class="text-xs font-semibold text-slate-700 mt-3 mb-1">$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^• (.+)$/gm, '<li class="ml-4 list-disc text-slate-600">$1</li>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-slate-600">$1</li>')
    .replace(/\n\n/g, '</p><p class="text-xs text-slate-600 mb-2">')
    .replace(/\n/g, ' ');
}

function AnalysisRunner({ metrics, summaries, checkinFieldCols, activeSlug }) {
  const [phase,          setPhase]          = useState('select'); // select|review|code|running|results
  const [plans,          setPlans]          = useState([]);
  const [plansLoading,   setPlansLoading]   = useState(true);
  const [selectedPlan,   setSelectedPlan]   = useState(null);
  const [sdThreshold,    setSdThreshold]    = useState(2);
  const [removedPoints,  setRemovedPoints]  = useState({});
  const [generatedCode,  setGeneratedCode]  = useState('');
  const [editableCode,   setEditableCode]   = useState('');
  const [codeLoading,    setCodeLoading]    = useState(false);
  const [runStatus,      setRunStatus]      = useState(''); // progress message
  const [runResults,     setRunResults]     = useState(null); // { tests, assumptions, descriptives, stdout }
  const [runError,       setRunError]       = useState('');
  const [interpreting,   setInterpreting]   = useState(false);
  const [interpretation, setInterpretation] = useState('');
  const [saving,         setSaving]         = useState(false);
  const [saved,          setSaved]          = useState(false);
  const pyodideRef = useRef(null);

  // ── Load saved plans on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!activeSlug) return;
    fetch(`/api/analysis/get-plans?study=${encodeURIComponent(activeSlug)}`)
      .then(r => r.json())
      .then(d => setPlans(d.plans || []))
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false));
  }, [activeSlug]);

  // ── Derive outlier data from metrics + selected plan ──────────────────────
  const allCols = metrics.length > 0
    ? Object.keys(metrics[0]).filter(k => !INTERNAL_PLAN_COLS.has(k) && k !== 'Condition')
    : [];
  const numericCols = allCols.filter(col => {
    const vals = metrics.map(r => r[col]).filter(v => v !== '' && v != null);
    return vals.length > 0 && vals.some(v => !isNaN(Number(v)));
  });
  const conditions = [...new Set(metrics.map(r => (r['Condition'] || '').trim()).filter(Boolean))].sort();
  const hasConditions = conditions.length > 0;

  // DVs from plan or fallback to all numeric
  const planDVs = selectedPlan
    ? (selectedPlan.dv || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean)
    : [];
  const analysedDVs = planDVs.length > 0 ? planDVs.filter(d => numericCols.includes(d)) : numericCols.slice(0, 4);

  // Per-DV per-condition descriptives (reuse same logic as PlanGenerator)
  const descriptivesByVar = {};
  analysedDVs.forEach(col => {
    descriptivesByVar[col] = {};
    const condList = hasConditions ? conditions : ['All'];
    condList.forEach(cond => {
      const rows = metrics.filter(r => !hasConditions || (r['Condition'] || '').trim() === cond);
      const vals = rows.map(r => ({
        val: Number(r[col]),
        subjectId: r['Subject ID'],
        date: (r['Date'] || '').toString().split('T')[0],
        raw: r[col],
      })).filter(d => !isNaN(d.val) && d.raw !== '' && d.raw != null);
      const stats = computeDescriptives(vals.map(d => d.val));
      const outliers = {};
      SD_THRESHOLDS.forEach(sd => {
        if (!stats) return;
        outliers[sd] = vals.filter(d => Math.abs(d.val - stats.mean) > sd * stats.sd);
      });
      descriptivesByVar[col][cond] = { stats, vals, outliers };
    });
  });

  function isRemoved(col, cond, subjectId, date) {
    return !!removedPoints[`${col}|${cond}|${subjectId}|${date}`];
  }
  function toggleRemove(col, cond, subjectId, date) {
    const key = `${col}|${cond}|${subjectId}|${date}`;
    setRemovedPoints(prev => ({ ...prev, [key]: !prev[key] }));
  }
  const totalRemoved = Object.values(removedPoints).filter(Boolean).length;

  // ── Build filtered metrics for Pyodide ────────────────────────────────────
  function getFilteredMetrics() {
    return metrics.filter(row => {
      for (const col of analysedDVs) {
        for (const cond of (hasConditions ? conditions : ['All'])) {
          const sid  = row['Subject ID'];
          const date = (row['Date'] || '').toString().split('T')[0];
          if (isRemoved(col, cond, sid, date)) return false;
        }
      }
      return true;
    });
  }

  // ── Load Pyodide (lazy, cached) ───────────────────────────────────────────
  async function initPyodide() {
    if (pyodideRef.current) return pyodideRef.current;
    setRunStatus('Loading Python runtime (Pyodide)…');
    await new Promise((resolve, reject) => {
      if (typeof window.loadPyodide === 'function') return resolve();
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js';
      script.onload  = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    const pyodide = await window.loadPyodide();
    setRunStatus('Installing scientific packages…');
    await pyodide.loadPackage(['numpy', 'pandas', 'scipy', 'statsmodels']);
    pyodideRef.current = pyodide;
    return pyodide;
  }

  // ── Generate code from Claude Haiku ──────────────────────────────────────
  async function handleGenerateCode() {
    setCodeLoading(true);
    setPhase('code');
    try {
      const res = await fetch('/api/analysis/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: selectedPlan,
          conditions,
          availableColumns: numericCols,
          n: metrics.length,
          removedCount: totalRemoved,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Code generation failed');
      setGeneratedCode(data.code);
      setEditableCode(data.code);
    } catch (err) {
      setEditableCode(`# Error generating code: ${err.message}\n# Please write your analysis code here manually.\n\nimport json\nimport numpy as np\nimport pandas as pd\nfrom scipy import stats\n\nresults = {"tests": [], "assumptions": [], "descriptives": []}\nprint("RESULTS_JSON:" + json.dumps(results))\n`);
    } finally {
      setCodeLoading(false);
    }
  }

  // ── Run analysis with Pyodide ─────────────────────────────────────────────
  async function handleRunAnalysis() {
    setPhase('running');
    setRunError('');
    setRunResults(null);
    setInterpretation('');
    setSaved(false);
    let stdout = '';

    try {
      const pyodide = await initPyodide();
      setRunStatus('Preparing data…');

      // Pass filtered metrics as JSON → Python builds df
      const filteredRows = getFilteredMetrics();
      await pyodide.globals.set('_raw_data_json', JSON.stringify(filteredRows));

      // Prefix: load df from the injected JSON
      const dataPrefix = `
import json as _json
import pandas as _pd
import io as _io
import sys as _sys

_data = _json.loads(_raw_data_json)
df = _pd.DataFrame(_data)
# Coerce numeric columns
for _col in df.columns:
    try:
        df[_col] = _pd.to_numeric(df[_col], errors='ignore')
    except Exception:
        pass

# Capture stdout
_stdout_buf = _io.StringIO()
_sys.stdout = _stdout_buf
`;

      const dataSuffix = `
_sys.stdout = _sys.__stdout__
_captured = _stdout_buf.getvalue()
_captured
`;

      setRunStatus('Running analysis…');
      const capturedOutput = await pyodide.runPythonAsync(dataPrefix + editableCode + dataSuffix);
      stdout = capturedOutput || '';

      // Parse RESULTS_JSON from output
      let resultsJson = { tests: [], assumptions: [], descriptives: [] };
      const marker = stdout.indexOf('RESULTS_JSON:');
      if (marker !== -1) {
        const jsonStr = stdout.slice(marker + 'RESULTS_JSON:'.length).trim();
        try { resultsJson = JSON.parse(jsonStr); } catch { /* ignore */ }
      }

      setRunResults({ ...resultsJson, stdout });
      setPhase('results');
    } catch (err) {
      // Restore stdout in case of error
      try { await pyodideRef.current?.runPythonAsync('import sys; sys.stdout = sys.__stdout__'); } catch { /* ignore */ }
      setRunError(err.message || 'Analysis failed');
      setPhase('code');
    }
  }

  // ── AI Interpretation ─────────────────────────────────────────────────────
  async function handleInterpret() {
    setInterpreting(true);
    try {
      const res = await fetch('/api/analysis/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: selectedPlan,
          resultsJson: runResults,
          removedCount: totalRemoved,
          studySlug: activeSlug,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInterpretation(data.interpretation);
    } catch (err) {
      setInterpretation(`*Error generating interpretation: ${err.message}*`);
    } finally {
      setInterpreting(false);
    }
  }

  // ── Save run to history ───────────────────────────────────────────────────
  async function handleSaveRun() {
    setSaving(true);
    try {
      const reportHtml = buildReportHtml();
      const res = await fetch('/api/analysis/save-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId:       selectedPlan?.id || '',
          planTitle:    selectedPlan?.title || '',
          study:        activeSlug,
          codeUsed:     editableCode,
          resultsJson:  runResults,
          interpretation,
          reportHtml,
          status:       'completed',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSaved(true);
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Build HTML report ─────────────────────────────────────────────────────
  function buildReportHtml() {
    const ts = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
    const tests = (runResults?.tests || []);
    const assumptions = (runResults?.assumptions || []);
    const descriptives = (runResults?.descriptives || []);

    const descTable = descriptives.length > 0 ? `
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:12px">
        <tr style="background:#f8fafc"><th>Variable</th><th>Condition</th><th>n</th><th>Mean</th><th>SD</th><th>Median</th><th>Min</th><th>Max</th></tr>
        ${descriptives.map(d => `<tr><td>${d.variable}</td><td>${d.condition}</td><td>${d.n}</td><td>${d.mean?.toFixed(3)}</td><td>${d.sd?.toFixed(3)}</td><td>${d.median?.toFixed(3)}</td><td>${d.min?.toFixed(3)}</td><td>${d.max?.toFixed(3)}</td></tr>`).join('')}
      </table>` : '<p>No descriptive statistics available.</p>';

    const testRows = tests.map(t => `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px;background:${t.significant ? '#f0fdf4' : '#f8fafc'}">
        <b>${t.name}</b> <span style="color:${t.significant ? '#16a34a' : '#94a3b8'};font-size:12px">${t.significant ? '✓ Significant' : 'Not significant'}</span><br/>
        <span style="font-size:12px;color:#475569">${t.details}</span><br/>
        <span style="font-size:11px;color:#64748b">${t.direction}</span>
      </div>`).join('');

    const assumRows = assumptions.map(a => `
      <tr>
        <td>${a.test}</td><td>${a.variable}</td><td>${a.condition || '—'}</td>
        <td style="color:${a.passed ? '#16a34a' : '#dc2626'}">${a.passed ? 'Passed' : 'Failed'}</td>
        <td style="font-size:11px">${a.interpretation}</td>
      </tr>`).join('');

    const interpHtml = interpretation
      ? `<h2>AI Interpretation</h2><div style="font-size:13px;line-height:1.7;color:#334155">${renderMarkdown(interpretation)}</div>`
      : '';

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Analysis Report — ${selectedPlan?.title || activeSlug}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#1e293b}
h1{font-size:22px;font-weight:700;color:#0f172a;margin-bottom:4px}
h2{font-size:16px;font-weight:600;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin-top:32px}
table{width:100%;font-size:12px;border-collapse:collapse}th,td{padding:6px 10px;border:1px solid #e2e8f0;text-align:left}
th{background:#f8fafc;font-weight:600}code{font-size:11px;background:#f1f5f9;padding:2px 5px;border-radius:3px}
pre{background:#0f172a;color:#e2e8f0;padding:16px;border-radius:8px;font-size:11px;overflow-x:auto;white-space:pre-wrap}
.meta{font-size:12px;color:#64748b;margin-bottom:24px}.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.sig{background:#dcfce7;color:#15803d}.ns{background:#f1f5f9;color:#64748b}</style></head>
<body>
<h1>Analysis Report</h1>
<div class="meta">
  <b>Plan:</b> ${selectedPlan?.title || '—'} &nbsp;|&nbsp;
  <b>Study:</b> ${activeSlug} &nbsp;|&nbsp;
  <b>Generated:</b> ${ts}<br/>
  <b>Design:</b> ${selectedPlan?.design || '—'} &nbsp;|&nbsp;
  <b>IV:</b> ${selectedPlan?.iv || '—'} &nbsp;|&nbsp;
  <b>DVs:</b> ${selectedPlan?.dv || '—'}<br/>
  ${totalRemoved > 0 ? `<b>Excluded data points:</b> ${totalRemoved}` : ''}
</div>

<h2>Descriptive Statistics</h2>
${descTable}

<h2>Statistical Test Results</h2>
${testRows || '<p>No test results.</p>'}

<h2>Assumption Checks</h2>
${assumptions.length > 0 ? `<table><tr><th>Test</th><th>Variable</th><th>Condition</th><th>Result</th><th>Interpretation</th></tr>${assumRows}</table>` : '<p>No assumption checks.</p>'}

${interpHtml}

<h2>Python Code</h2>
<pre>${editableCode.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>

<h2>Raw Output</h2>
<pre>${(runResults?.stdout || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body></html>`;
  }

  // ── Download HTML report ──────────────────────────────────────────────────
  function handleDownloadReport() {
    const html = buildReportHtml();
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `analysis-report-${activeSlug}-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  // Phase: SELECT PLAN
  if (phase === 'select') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Run Analysis</h2>
            <p className="text-xs text-slate-400 mt-0.5">Select a saved analysis plan to get started</p>
          </div>
        </div>

        {plansLoading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-xs text-slate-400">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25"/>
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" className="opacity-75"/>
            </svg>
            Loading plans…
          </div>
        ) : plans.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
            <p className="text-sm font-medium text-slate-600 mb-1">No analysis plans yet</p>
            <p className="text-xs text-slate-400">Create a plan in the Plan Generator tab first.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {plans.map((p, i) => (
              <div key={i}
                onClick={() => { setSelectedPlan(p); setPhase('review'); setRemovedPoints({}); }}
                className="bg-white border border-slate-200 rounded-xl px-4 py-3 cursor-pointer hover:border-violet-300 hover:bg-violet-50 transition-all group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{p.title || 'Untitled Plan'}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{p.design} · IV: {p.iv} · DVs: {p.dv}</p>
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <span className="text-xs text-slate-400">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ''}</span>
                    <svg className="w-4 h-4 text-slate-300 group-hover:text-violet-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                    </svg>
                  </div>
                </div>
                {p.statisticalTests && (
                  <p className="text-xs text-slate-400 mt-1 truncate">Tests: {p.statisticalTests}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Phase: REVIEW DATA
  if (phase === 'review') {
    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <button onClick={() => setPhase('select')} className="text-xs text-violet-500 hover:text-violet-700 mb-1 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              Back to plans
            </button>
            <h2 className="text-sm font-semibold text-slate-800">{selectedPlan?.title || 'Review Data'}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{selectedPlan?.design} · IV: {selectedPlan?.iv} · DVs: {selectedPlan?.dv}</p>
          </div>
          <button onClick={handleGenerateCode}
            className="flex-shrink-0 px-4 py-2 bg-violet-500 hover:bg-violet-600 text-white rounded-xl text-xs font-semibold transition-colors">
            Generate Code →
          </button>
        </div>

        {/* SD threshold toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Show outliers at:</span>
          {SD_THRESHOLDS.map(sd => (
            <button key={sd} onClick={() => setSdThreshold(sd)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${sdThreshold === sd ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {sd}σ
            </button>
          ))}
          {totalRemoved > 0 && (
            <span className="ml-3 text-xs text-amber-600 font-medium">{totalRemoved} point{totalRemoved !== 1 ? 's' : ''} excluded</span>
          )}
        </div>

        {/* Per-DV per-condition descriptive stats + outlier charts */}
        {analysedDVs.length === 0 ? (
          <p className="text-xs text-slate-400">No numeric columns found matching this plan's DVs.</p>
        ) : (
          analysedDVs.map(col => (
            <div key={col} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">{col}</h3>
              {(hasConditions ? conditions : ['All']).map(cond => {
                const entry = descriptivesByVar[col]?.[cond];
                if (!entry) return null;
                const { stats, vals, outliers } = entry;
                const outlierSet = new Set((outliers[sdThreshold] || []).map(d => `${d.subjectId}|${d.date}`));
                const removedVals = vals.filter(d => isRemoved(col, cond, d.subjectId, d.date));
                return (
                  <div key={cond} className="border border-slate-100 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600">{cond}</span>
                      {removedVals.length > 0 && (
                        <span className="text-xs text-amber-600">{removedVals.length} excluded</span>
                      )}
                    </div>
                    {stats && (
                      <div className="grid grid-cols-5 gap-2">
                        {[['n', stats.n], ['Mean', stats.mean?.toFixed(2)], ['SD', stats.sd?.toFixed(2)], ['Median', stats.median?.toFixed(2)], ['Range', `${stats.min?.toFixed(1)}–${stats.max?.toFixed(1)}`]].map(([label, val]) => (
                          <div key={label} className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                            <div className="text-[10px] text-slate-400">{label}</div>
                            <div className="text-xs font-semibold text-slate-700">{val}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <OutlierChart
                      col={col} cond={cond} vals={vals} stats={stats}
                      sdThreshold={sdThreshold} isRemoved={isRemoved} onToggleRemove={toggleRemove}
                    />
                    {/* Outlier list */}
                    {(outliers[sdThreshold] || []).length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                          {(outliers[sdThreshold] || []).length} outlier{(outliers[sdThreshold] || []).length !== 1 ? 's' : ''} at {sdThreshold}σ
                        </p>
                        {(outliers[sdThreshold] || []).map((d, i) => {
                          const removed = isRemoved(col, cond, d.subjectId, d.date);
                          return (
                            <div key={i} className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs ${removed ? 'bg-slate-50 opacity-50' : 'bg-red-50'}`}>
                              <span className={removed ? 'text-slate-400 line-through' : 'text-slate-700'}>
                                {d.subjectId} · {d.date} · <strong>{d.val?.toFixed(3)}</strong>
                                <span className="text-slate-400 ml-1">({Math.abs(d.val - stats.mean) / stats.sd > 0 ? `${(Math.abs(d.val - stats.mean) / stats.sd).toFixed(1)}σ` : ''})</span>
                              </span>
                              <button onClick={() => toggleRemove(col, cond, d.subjectId, d.date)}
                                className={`ml-3 text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${removed ? 'bg-slate-200 text-slate-500 hover:bg-green-100 hover:text-green-700' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}>
                                {removed ? 'Restore' : 'Exclude'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    );
  }

  // Phase: CODE
  if (phase === 'code') {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <button onClick={() => setPhase('review')} className="text-xs text-violet-500 hover:text-violet-700 mb-1 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              Back to review
            </button>
            <h2 className="text-sm font-semibold text-slate-800">Analysis Code</h2>
            <p className="text-xs text-slate-500 mt-0.5">Review and edit before running · <code className="bg-slate-100 px-1 rounded">df</code> is pre-loaded as a pandas DataFrame</p>
          </div>
          <button onClick={handleRunAnalysis} disabled={!editableCode || codeLoading}
            className="flex-shrink-0 px-4 py-2 bg-violet-500 hover:bg-violet-600 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-xs font-semibold transition-colors">
            ▶ Run Analysis
          </button>
        </div>

        {codeLoading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-slate-400 justify-center">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25"/>
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" className="opacity-75"/>
            </svg>
            Generating code…
          </div>
        ) : (
          <div className="relative">
            <textarea
              value={editableCode}
              onChange={e => setEditableCode(e.target.value)}
              className="w-full h-[480px] bg-slate-900 text-emerald-300 font-mono text-xs rounded-2xl p-4 resize-none border-0 outline-none focus:ring-2 focus:ring-violet-400"
              spellCheck={false}
              placeholder="# Python code will appear here…"
            />
            <button onClick={() => setEditableCode(generatedCode)}
              className="absolute top-3 right-3 text-[10px] text-slate-500 bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded-md transition-colors">
              Reset
            </button>
          </div>
        )}

        {runError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
            <strong>Error:</strong> {runError}
          </div>
        )}

        {totalRemoved > 0 && (
          <div className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2">
            ⚠ {totalRemoved} data point{totalRemoved !== 1 ? 's' : ''} excluded from analysis (rows already filtered before passing to Python).
          </div>
        )}
      </div>
    );
  }

  // Phase: RUNNING
  if (phase === 'running') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-violet-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25"/>
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" className="opacity-75"/>
          </svg>
        </div>
        <p className="text-sm font-semibold text-slate-700">{runStatus || 'Running…'}</p>
        <p className="text-xs text-slate-400">Running Python in your browser via Pyodide</p>
      </div>
    );
  }

  // Phase: RESULTS
  if (phase === 'results' && runResults) {
    const tests       = runResults.tests || [];
    const assumptions = runResults.assumptions || [];
    const descriptives = runResults.descriptives || [];

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <button onClick={() => setPhase('code')} className="text-xs text-violet-500 hover:text-violet-700 mb-1 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              Back to code
            </button>
            <h2 className="text-sm font-semibold text-slate-800">Results — {selectedPlan?.title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleDownloadReport}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:border-violet-300 text-slate-600 hover:text-violet-600 rounded-xl text-xs font-semibold transition-colors">
              ↓ Download Report
            </button>
            <button onClick={handleSaveRun} disabled={saving || saved}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${saved ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-violet-500 hover:bg-violet-600 text-white'}`}>
              {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save to History'}
            </button>
          </div>
        </div>

        {/* Assumption checks */}
        {assumptions.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Assumption Checks</h3>
            <div className="space-y-1.5">
              {assumptions.map((a, i) => (
                <div key={i} className={`flex items-start justify-between gap-3 px-3 py-2 rounded-lg text-xs ${a.passed ? 'bg-green-50' : 'bg-amber-50'}`}>
                  <div>
                    <span className="font-semibold text-slate-700">{a.test}</span>
                    <span className="text-slate-400 ml-2">{a.variable}{a.condition ? ` [${a.condition}]` : ''}</span>
                    <span className="text-slate-500 ml-2">{a.interpretation}</span>
                  </div>
                  <span className={`flex-shrink-0 font-bold ${a.passed ? 'text-green-600' : 'text-amber-600'}`}>
                    {a.passed ? '✓ Passed' : '⚠ Failed'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Main test results */}
        {tests.length > 0 && (
          <div className="space-y-4">
            {tests.map((t, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">{t.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{t.details}</p>
                    {t.direction && <p className="text-xs text-slate-600 mt-0.5 font-medium">{t.direction}</p>}
                  </div>
                  <span className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold ${t.significant ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {t.significant ? `p = ${t.pValue?.toFixed(3)}` : `p = ${t.pValue?.toFixed(3)} ns`}
                  </span>
                </div>
                {/* Bar chart: mean per condition */}
                {(t.chartData || []).length > 0 && (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={t.chartData} margin={{ top: 4, right: 16, left: -20, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs">
                              <p className="font-semibold text-slate-700">{d.label}</p>
                              <p>M = {d.mean?.toFixed(3)}, SD = {d.sd?.toFixed(3)}</p>
                              <p className="text-slate-400">n = {d.n}</p>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="mean" radius={[6, 6, 0, 0]}>
                        {(t.chartData || []).map((_, ci) => (
                          <Cell key={ci} fill={['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444'][ci % 5]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {t.effectSize != null && (
                  <p className="text-xs text-slate-400 mt-2">Effect size: {t.effectSizeType} = {t.effectSize?.toFixed(3)}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Descriptives table */}
        {descriptives.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Descriptive Statistics</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Variable', 'Condition', 'n', 'Mean', 'SD', 'Median', 'Min', 'Max'].map(h => (
                      <th key={h} className="text-left pb-2 pr-4 text-slate-400 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {descriptives.map((d, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-1.5 pr-4 font-medium text-slate-700">{d.variable}</td>
                      <td className="py-1.5 pr-4 text-slate-500">{d.condition}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.n}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.mean?.toFixed(3)}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.sd?.toFixed(3)}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.median?.toFixed(3)}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.min?.toFixed(3)}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.max?.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* AI Interpretation */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">AI Interpretation</h3>
            {!interpretation && !interpreting && (
              <button onClick={handleInterpret}
                className="px-3 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-600 rounded-lg text-xs font-semibold transition-colors">
                ✦ Get Interpretation
              </button>
            )}
          </div>
          {interpreting ? (
            <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25"/>
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" className="opacity-75"/>
              </svg>
              Interpreting results…
            </div>
          ) : interpretation ? (
            <div className="text-xs leading-relaxed text-slate-600 space-y-1"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(interpretation) }} />
          ) : (
            <p className="text-xs text-slate-400 italic">Click "Get Interpretation" to have Claude Sonnet interpret these results.</p>
          )}
        </div>

        {/* Raw output (collapsible) */}
        {runResults.stdout && (
          <details className="bg-white border border-slate-200 rounded-2xl">
            <summary className="px-4 py-3 text-xs font-semibold text-slate-500 cursor-pointer select-none">
              Raw Python Output
            </summary>
            <pre className="px-4 pb-4 text-[10px] font-mono text-emerald-400 bg-slate-900 rounded-b-2xl overflow-x-auto whitespace-pre-wrap max-h-48">
              {runResults.stdout}
            </pre>
          </details>
        )}
      </div>
    );
  }

  return null;
}

// ─── AnalysisHistory ──────────────────────────────────────────────────────────

const HIST_TAB_KEY  = (slug) => `analysis_hist_tab_${slug}`;
const REF_DAPS_KEY  = (slug) => `analysis_ref_daps_${slug}`;

function AnalysisHistory({ activeSlug }) {
  const [histTab,      setHistTab]      = useState(() => {
    try { return localStorage.getItem(HIST_TAB_KEY(activeSlug)) || 'runs'; } catch { return 'runs'; }
  });
  const [runs,         setRuns]         = useState([]);
  const [runsLoading,  setRunsLoading]  = useState(true);
  const [plans,        setPlans]        = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [expandedRun,  setExpandedRun]  = useState(null); // run object currently open
  const [expandedPlan, setExpandedPlan] = useState(null); // plan object currently open
  const [daps,         setDaps]         = useState([]);   // reference DAPs from localStorage
  const [dapUploading, setDapUploading] = useState(false);
  const dapInputRef = useRef(null);

  // Q&A state (per expanded run)
  const [qaMessages, setQaMessages] = useState([]); // [{ role, content }]
  const [qaInput,    setQaInput]    = useState('');
  const [qaLoading,  setQaLoading]  = useState(false);
  const qaEndRef = useRef(null);

  // Persist sub-tab
  function switchHistTab(tab) {
    setHistTab(tab);
    try { localStorage.setItem(HIST_TAB_KEY(activeSlug), tab); } catch { /* ignore */ }
  }

  // Load runs + plans on mount
  useEffect(() => {
    if (!activeSlug) return;
    fetch(`/api/analysis/get-runs?study=${encodeURIComponent(activeSlug)}`)
      .then(r => r.json()).then(d => setRuns(d.runs || [])).catch(() => setRuns([]))
      .finally(() => setRunsLoading(false));
    fetch(`/api/analysis/get-plans?study=${encodeURIComponent(activeSlug)}`)
      .then(r => r.json()).then(d => setPlans(d.plans || [])).catch(() => setPlans([]))
      .finally(() => setPlansLoading(false));
  }, [activeSlug]);

  // Load reference DAPs from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(REF_DAPS_KEY(activeSlug));
      setDaps(stored ? JSON.parse(stored) : []);
    } catch { setDaps([]); }
  }, [activeSlug]);

  function saveDaps(next) {
    setDaps(next);
    try { localStorage.setItem(REF_DAPS_KEY(activeSlug), JSON.stringify(next)); } catch { /* ignore */ }
  }

  // ── Reference DAP upload ──────────────────────────────────────────────────
  async function handleDapUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDapUploading(true);
    try {
      const text = await file.text();
      const newDap = { name: file.name, content: text.slice(0, 8000), uploadedAt: new Date().toISOString() };
      saveDaps([newDap, ...daps.filter(d => d.name !== file.name)].slice(0, 5)); // max 5 DAPs
    } catch (err) {
      alert(`Could not read file: ${err.message}`);
    } finally {
      setDapUploading(false);
      if (dapInputRef.current) dapInputRef.current.value = '';
    }
  }

  // ── Expand a run and reset Q&A ────────────────────────────────────────────
  function openRun(run) {
    setExpandedRun(run);
    setQaMessages([]);
    setQaInput('');
    setExpandedPlan(null);
  }

  // ── Download HTML report ──────────────────────────────────────────────────
  function downloadReport(run) {
    if (!run.reportHtml) return;
    const blob = new Blob([run.reportHtml], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `analysis-report-${run.planTitle || run.id}.html`.replace(/\s+/g, '-');
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Q&A submit ────────────────────────────────────────────────────────────
  async function handleQaSubmit(e) {
    e.preventDefault();
    if (!qaInput.trim() || qaLoading || !expandedRun) return;
    const question = qaInput.trim();
    setQaInput('');
    const newMessages = [...qaMessages, { role: 'user', content: question }];
    setQaMessages(newMessages);
    setQaLoading(true);
    setTimeout(() => qaEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    try {
      const res = await fetch('/api/analysis/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history:        qaMessages,
          planTitle:      expandedRun.planTitle,
          resultsJson:    expandedRun.results,
          interpretation: expandedRun.interpretation,
          studySlug:      activeSlug,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQaMessages([...newMessages, { role: 'assistant', content: data.answer }]);
    } catch (err) {
      setQaMessages([...newMessages, { role: 'assistant', content: `*Error: ${err.message}*` }]);
    } finally {
      setQaLoading(false);
      setTimeout(() => qaEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Sub-tab nav
  const histTabs = [
    { key: 'runs',  label: 'Analysis Runs' },
    { key: 'plans', label: 'Saved Plans'   },
    { key: 'daps',  label: 'Reference DAPs'},
  ];

  // ── Detail view: expanded run ─────────────────────────────────────────────
  if (expandedRun) {
    const run     = expandedRun;
    const tests   = run.results?.tests       || [];
    const assmpts = run.results?.assumptions || [];
    const descs   = run.results?.descriptives || [];

    return (
      <div className="space-y-5">
        {/* Back + actions */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <button onClick={() => setExpandedRun(null)}
              className="text-xs text-violet-500 hover:text-violet-700 mb-1 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
              </svg>
              Back to history
            </button>
            <h2 className="text-sm font-semibold text-slate-800">{run.planTitle || 'Analysis Run'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {run.createdAt ? new Date(run.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
              {run.status ? ` · ${run.status}` : ''}
            </p>
          </div>
          {run.reportHtml && (
            <button onClick={() => downloadReport(run)}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:border-violet-300 text-slate-600 hover:text-violet-600 rounded-xl text-xs font-semibold transition-colors">
              ↓ Download Report
            </button>
          )}
        </div>

        {/* Test results */}
        {tests.length > 0 && (
          <div className="space-y-3">
            {tests.map((t, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-2xl px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{t.details}</p>
                    {t.direction && <p className="text-xs text-slate-600 mt-0.5 font-medium">{t.direction}</p>}
                  </div>
                  <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${t.significant ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    p = {t.pValue?.toFixed(3) ?? '—'}
                  </span>
                </div>
                {t.effectSize != null && (
                  <p className="text-xs text-slate-400 mt-1">{t.effectSizeType} = {t.effectSize?.toFixed(3)}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Assumption checks */}
        {assmpts.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Assumption Checks</h3>
            <div className="space-y-1.5">
              {assmpts.map((a, i) => (
                <div key={i} className={`flex items-start justify-between gap-3 px-3 py-2 rounded-lg text-xs ${a.passed ? 'bg-green-50' : 'bg-amber-50'}`}>
                  <span className="text-slate-600">{a.test} · <span className="font-medium">{a.variable}</span>{a.condition ? ` [${a.condition}]` : ''} — {a.interpretation}</span>
                  <span className={`flex-shrink-0 font-bold ${a.passed ? 'text-green-600' : 'text-amber-600'}`}>{a.passed ? '✓' : '⚠'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Descriptives table */}
        {descs.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Descriptive Statistics</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Variable','Condition','n','Mean','SD','Median','Min','Max'].map(h => (
                      <th key={h} className="text-left pb-2 pr-4 text-slate-400 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {descs.map((d, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-1.5 pr-4 font-medium text-slate-700">{d.variable}</td>
                      <td className="py-1.5 pr-4 text-slate-500">{d.condition}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.n}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.mean?.toFixed(3)}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.sd?.toFixed(3)}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.median?.toFixed(3)}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.min?.toFixed(3)}</td>
                      <td className="py-1.5 pr-4 text-slate-600">{d.max?.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Interpretation */}
        {run.interpretation && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">AI Interpretation</h3>
            <div className="text-xs leading-relaxed text-slate-600"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(run.interpretation) }} />
          </div>
        )}

        {/* ── Stakeholder Q&A ──────────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Stakeholder Q&amp;A</h3>
          <p className="text-xs text-slate-400 mb-3">Ask questions about this analysis — Claude will answer based on the results and interpretation above.</p>

          {/* Message thread */}
          {qaMessages.length > 0 && (
            <div className="space-y-3 mb-4 max-h-80 overflow-y-auto pr-1">
              {qaMessages.map((m, i) => (
                <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[9px] font-bold text-violet-600">AI</span>
                    </div>
                  )}
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-violet-500 text-white rounded-br-sm'
                      : 'bg-slate-50 text-slate-700 rounded-bl-sm border border-slate-100'
                  }`}>
                    {m.role === 'assistant'
                      ? <span dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                      : m.content}
                  </div>
                </div>
              ))}
              {qaLoading && (
                <div className="flex gap-2.5 justify-start">
                  <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold text-violet-600">AI</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl rounded-bl-sm px-3 py-2">
                    <svg className="w-4 h-4 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25"/>
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" className="opacity-75"/>
                    </svg>
                  </div>
                </div>
              )}
              <div ref={qaEndRef} />
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleQaSubmit} className="flex gap-2">
            <input
              value={qaInput}
              onChange={e => setQaInput(e.target.value)}
              disabled={qaLoading}
              placeholder="Ask a question about this analysis…"
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300 disabled:opacity-50"
            />
            <button type="submit" disabled={!qaInput.trim() || qaLoading}
              className="px-3 py-2 bg-violet-500 hover:bg-violet-600 disabled:bg-slate-200 text-white disabled:text-slate-400 rounded-xl text-xs font-semibold transition-colors">
              Ask
            </button>
          </form>
        </div>

        {/* Code used (collapsible) */}
        {run.codeUsed && (
          <details className="bg-white border border-slate-200 rounded-2xl">
            <summary className="px-4 py-3 text-xs font-semibold text-slate-500 cursor-pointer select-none">
              Python Code Used
            </summary>
            <pre className="px-4 pb-4 text-[10px] font-mono text-emerald-400 bg-slate-900 rounded-b-2xl overflow-x-auto whitespace-pre-wrap max-h-64">
              {run.codeUsed}
            </pre>
          </details>
        )}
      </div>
    );
  }

  // ── Detail view: expanded plan ────────────────────────────────────────────
  if (expandedPlan) {
    const p = expandedPlan;
    return (
      <div className="space-y-4">
        <div>
          <button onClick={() => setExpandedPlan(null)}
            className="text-xs text-violet-500 hover:text-violet-700 mb-1 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
            Back to plans
          </button>
          <h2 className="text-sm font-semibold text-slate-800">{p['Title'] || p.title || 'Untitled Plan'}</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {p['Created At'] || p.createdAt ? new Date(p['Created At'] || p.createdAt).toLocaleDateString() : ''}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Design',   p['Design']   || p.design   || '—'],
            ['IV',       p['IV']       || p.iv       || '—'],
            ['DVs',      p['DV']       || p.dv       || '—'],
            ['Conditions', p['Conditions'] || p.conditions || '—'],
            ['Tests',    p['Statistical Tests'] || p.statisticalTests || '—'],
            ['Primary Outcome', p['Primary Outcome'] || p.primaryOutcome || '—'],
          ].map(([label, val]) => (
            <div key={label} className="bg-slate-50 rounded-xl px-3 py-2">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
              <p className="text-xs text-slate-700 mt-0.5">{val}</p>
            </div>
          ))}
        </div>
        {(p['Full Text'] || p.planMarkdown) && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Full Analysis Plan</h3>
            <div className="text-xs leading-relaxed text-slate-600 whitespace-pre-wrap font-mono">
              {p['Full Text'] || p.planMarkdown}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── List views ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Sub-tab nav */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {histTabs.map(t => (
          <button key={t.key} onClick={() => switchHistTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              histTab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── RUNS tab ─────────────────────────────────────────────────── */}
      {histTab === 'runs' && (
        <div className="space-y-2">
          {runsLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-xs text-slate-400">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25"/>
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" className="opacity-75"/>
              </svg>
              Loading runs…
            </div>
          ) : runs.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
              <p className="text-sm font-medium text-slate-600 mb-1">No analysis runs yet</p>
              <p className="text-xs text-slate-400">Run an analysis in the Run Analysis tab to see results here.</p>
            </div>
          ) : (
            runs.map((run, i) => {
              const sigCount = (run.results?.tests || []).filter(t => t.significant).length;
              const totalTests = (run.results?.tests || []).length;
              return (
                <div key={i} onClick={() => openRun(run)}
                  className="bg-white border border-slate-200 rounded-xl px-4 py-3 cursor-pointer hover:border-violet-300 hover:bg-violet-50 transition-all group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{run.planTitle || 'Untitled Run'}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {run.createdAt ? new Date(run.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                      </p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {totalTests > 0 && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sigCount > 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {sigCount}/{totalTests} sig.
                        </span>
                      )}
                      <svg className="w-4 h-4 text-slate-300 group-hover:text-violet-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                      </svg>
                    </div>
                  </div>
                  {run.interpretation && (
                    <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">
                      {run.interpretation.replace(/#{1,4} /g, '').replace(/\*\*/g, '').slice(0, 160)}…
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── PLANS tab ────────────────────────────────────────────────── */}
      {histTab === 'plans' && (
        <div className="space-y-2">
          {plansLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-xs text-slate-400">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25"/>
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" className="opacity-75"/>
              </svg>
              Loading plans…
            </div>
          ) : plans.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
              <p className="text-sm font-medium text-slate-600 mb-1">No saved plans yet</p>
              <p className="text-xs text-slate-400">Create a plan in the Plan Generator tab to see it here.</p>
            </div>
          ) : (
            plans.map((p, i) => (
              <div key={i} onClick={() => setExpandedPlan(p)}
                className="bg-white border border-slate-200 rounded-xl px-4 py-3 cursor-pointer hover:border-violet-300 hover:bg-violet-50 transition-all group">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{p['Title'] || p.title || 'Untitled Plan'}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{p['Design'] || p.design} · IV: {p['IV'] || p.iv} · DVs: {p['DV'] || p.dv}</p>
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <span className="text-xs text-slate-400">{p['Created At'] ? new Date(p['Created At']).toLocaleDateString() : ''}</span>
                    <svg className="w-4 h-4 text-slate-300 group-hover:text-violet-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                    </svg>
                  </div>
                </div>
                {(p['Statistical Tests'] || p.statisticalTests) && (
                  <p className="text-xs text-slate-400 mt-1 truncate">Tests: {p['Statistical Tests'] || p.statisticalTests}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── REFERENCE DAPs tab ───────────────────────────────────────── */}
      {histTab === 'daps' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Upload past analysis plans (DAPs) as plain-text reference files. Claude uses these to match your team's style and preferred methods when generating new plans.
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Accepts .txt or .md files · Max 5 files · Max 8,000 characters each</p>
            </div>
            <div>
              <input ref={dapInputRef} type="file" accept=".txt,.md" onChange={handleDapUpload}
                className="hidden" id="dap-upload" />
              <label htmlFor="dap-upload"
                className={`cursor-pointer px-3 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-600 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${dapUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {dapUploading ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25"/>
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" className="opacity-75"/>
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                  </svg>
                )}
                Upload DAP
              </label>
            </div>
          </div>

          {daps.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
              <p className="text-sm font-medium text-slate-600 mb-1">No reference DAPs uploaded</p>
              <p className="text-xs text-slate-400">Upload a past analysis plan to improve future plan generation.</p>
            </div>
          ) : (
            daps.map((dap, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700 truncate">{dap.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {dap.content.length.toLocaleString()} chars ·
                      Uploaded {new Date(dap.uploadedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button onClick={() => saveDaps(daps.filter((_, j) => j !== i))}
                    className="flex-shrink-0 text-xs text-red-400 hover:text-red-600 font-semibold transition-colors">
                    Remove
                  </button>
                </div>
                <details className="mt-2">
                  <summary className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-600 select-none">Preview</summary>
                  <pre className="mt-1 text-[10px] text-slate-500 bg-slate-50 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap max-h-32">
                    {dap.content.slice(0, 500)}{dap.content.length > 500 ? '…' : ''}
                  </pre>
                </details>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── AnalysisView ─────────────────────────────────────────────────────────────

function AnalysisView({ summaries, metrics, stats, activeSlug }) {
  // ── Compliance over time ─────────────────────────────────────────────────
  // Group metrics by date, count unique participants with data each day
  const totalParticipants = summaries.length;
  const byDate = {};
  metrics.forEach((m) => {
    const date = (m['Date'] || '').toString().split('T')[0];
    if (!date) return;
    if (!byDate[date]) byDate[date] = new Set();
    byDate[date].add(m['Subject ID']);
  });
  const complianceData = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30) // last 30 days
    .map(([date, ids]) => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      pct:  totalParticipants > 0 ? Math.round((ids.size / totalParticipants) * 100) : 0,
      n:    ids.size,
    }));

  // ── Check-in field pass rates ────────────────────────────────────────────
  const fieldData = (stats.fieldStats || []).map(({ label, valid, invalid, noData }) => {
    const total = valid + invalid + noData;
    return {
      name:    label,
      pass:    valid,
      fail:    invalid,
      noData,
      passPct: total > 0 ? Math.round((valid / total) * 100) : 0,
    };
  });

  // ── Progress distribution ────────────────────────────────────────────────
  const buckets = { '0–24%': 0, '25–49%': 0, '50–74%': 0, '75–99%': 0, '100%': 0 };
  summaries.forEach(({ pct }) => {
    if (pct === 100)      buckets['100%']++;
    else if (pct >= 75)   buckets['75–99%']++;
    else if (pct >= 50)   buckets['50–74%']++;
    else if (pct >= 25)   buckets['25–49%']++;
    else                  buckets['0–24%']++;
  });
  const progressData = Object.entries(buckets).map(([name, value]) => ({ name, value }));
  const PROGRESS_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6'];

  return (
    <div className="space-y-6">

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Compliance over time */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Daily Compliance (last 30 days)</h3>
          <p className="text-xs text-slate-400 mb-4">% of participants who submitted data each day</p>
          {complianceData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-xs text-slate-400">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={complianceData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} domain={[0, 100]} unit="%" />
                <Tooltip
                  formatter={(v, _, props) => [`${v}% (${props.payload.n} participants)`, 'Compliance']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Line type="monotone" dataKey="pct" stroke="#6366f1" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Progress distribution */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Participant Progress Distribution</h3>
          <p className="text-xs text-slate-400 mb-4">How far along each participant is in the study</p>
          {summaries.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-xs text-slate-400">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={progressData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(v) => [v, 'Participants']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {progressData.map((_, i) => (
                    <Cell key={i} fill={PROGRESS_COLORS[i % PROGRESS_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Check-in field pass rates */}
        {fieldData.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-slate-700 mb-1">Check-in Field Results (last night)</h3>
            <p className="text-xs text-slate-400 mb-4">Pass vs fail vs no data per field</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={fieldData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="pass"   name="Pass"    stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
                <Bar dataKey="fail"   name="Fail"    stackId="a" fill="#ef4444" />
                <Bar dataKey="noData" name="No Data" stackId="a" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── AI Analysis Chat ── */}
      <AnalysisChat summaries={summaries} metrics={metrics} stats={stats} activeSlug={activeSlug} />
    </div>
  );
}

// ─── AnalysisChat ─────────────────────────────────────────────────────────────

const ANALYSIS_STORAGE_KEY = (slug) => `analysis_chat_${slug}`;

const INITIAL_MESSAGE = {
  role: 'assistant',
  content: "Hey! I can help you dig into your study data — trends, outliers, compliance patterns, anything you want to explore. What would you like to know?",
};

function AnalysisChat({ summaries, metrics, stats, activeSlug }) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const bottomRef               = useRef(null);

  // Load persisted history on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ANALYSIS_STORAGE_KEY(activeSlug));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch {}
    setHydrated(true);
  }, [activeSlug]);

  // Persist history on every change (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(ANALYSIS_STORAGE_KEY(activeSlug), JSON.stringify(messages));
    } catch {}
  }, [messages, activeSlug, hydrated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function clearHistory() {
    setMessages([INITIAL_MESSAGE]);
    try { localStorage.removeItem(ANALYSIS_STORAGE_KEY(activeSlug)); } catch {}
  }

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

  const suggestions = [
    'What trends do you see in compliance over time?',
    'Which participants are falling behind?',
    'Summarize the check-in results from the past week',
    'Are there any outliers in the metrics data?',
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-slate-700">Data Analysis Assistant</h3>
        <span className="ml-auto text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">Powered by Claude</span>
        {messages.length > 1 && (
          <button
            onClick={clearHistory}
            className="text-xs text-slate-400 hover:text-red-500 transition ml-2"
            title="Clear chat history"
          >
            Clear history
          </button>
        )}
      </div>

      {/* Message thread */}
      <div className="bg-slate-50 rounded-xl p-4 space-y-3 max-h-96 overflow-y-auto mb-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'bg-violet-600 text-white'
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

      {/* Suggestion chips */}
      {messages.length === 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setInput(s)}
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
          placeholder="Ask anything about your study data…"
          disabled={loading}
          className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-4 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-40 transition"
        >
          Send
        </button>
      </form>
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
