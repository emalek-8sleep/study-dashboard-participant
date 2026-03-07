/**
 * /admin — Study Coordinator Dashboard
 *
 * Protected by an admin code set in Study Config (key: admin_code).
 * Shows all participants' progress, daily status, and open questions at a glance.
 *
 * Authentication flow:
 *   1. Visit /admin → see a code entry form if no valid session cookie
 *   2. Submit the form → POST to /api/admin-auth → sets cookie → redirect to /admin
 *   3. /admin reads cookie, verifies against Study Config, shows dashboard
 */

import Head from 'next/head';
import { useState } from 'react';
import {
  getStudyConfig,
  getAllParticipants,
  getAllDailyStatuses,
  getAllComments,
  getPhases,
  getCheckinFields,
  deriveProgress,
} from '../lib/sheets';

// ─── Server-side ─────────────────────────────────────────────────────────────

export async function getServerSideProps({ req, query }) {
  const config = await getStudyConfig();
  const adminCode = (config.admin_code || '').trim();

  // Check the session cookie
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionCode = decodeURIComponent(cookies['admin_session'] || '');
  const authenticated = adminCode && sessionCode === adminCode;

  if (!authenticated) {
    return {
      props: {
        authenticated: false,
        studyName: config.study_name || 'Study Dashboard',
        error: query.error || null,
        adminCodeConfigured: !!adminCode,
      },
    };
  }

  // Fetch all data in parallel
  const [participants, allStatuses, allComments, phases, checkinFields] = await Promise.all([
    getAllParticipants(),
    getAllDailyStatuses(),
    getAllComments(),
    getPhases(),
    getCheckinFields(),
  ]);

  // Build per-participant summary
  const summaries = participants.map((p) => {
    const id       = (p['Subject ID'] || '').trim();
    const normId   = id.toLowerCase();
    const progress = deriveProgress(p, phases);
    const status   = allStatuses[normId] || null;

    const completedDays = progress.reduce((s, ph) => s + ph.completedDays, 0);
    const totalDays     = progress.reduce((s, ph) => s + ph.totalDays, 0);
    const pct           = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;
    const currentPhase  = progress.find((ph) => ph.status === 'inprogress') || progress.find((ph) => ph.status === 'pending');

    // Check-in issues
    const issueCount = status
      ? checkinFields.filter((f) => isInvalid(status[f['Column Name']] || '')).length
      : 0;
    const checkinGood = status
      ? issueCount === 0 && checkinFields.some((f) => isValid(status[f['Column Name']] || ''))
      : false;
    const checkinDate = status ? status['Date'] : null;

    // Open comments (no coordinator response yet)
    const participantComments = allComments.filter(
      (c) => (c['Subject ID'] || '').toLowerCase().trim() === normId
    );
    const openComments = participantComments.filter((c) => !(c['Coordinator Response'] || '').trim());

    return {
      id,
      firstName: p['First Name'] || '',
      lastName:  p['Last Name']  || '',
      pct,
      completedDays,
      totalDays,
      currentPhase: currentPhase ? currentPhase.phaseName : null,
      currentPhaseStatus: currentPhase ? currentPhase.status : null,
      issueCount,
      checkinGood,
      checkinDate,
      noData: !status,
      openComments: openComments.length,
      totalComments: participantComments.length,
    };
  });

  // Sort: participants with issues first, then alphabetically
  summaries.sort((a, b) => {
    const aUrgent = (a.issueCount > 0 || a.openComments > 0) ? 0 : 1;
    const bUrgent = (b.issueCount > 0 || b.openComments > 0) ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    return (a.id).localeCompare(b.id);
  });

  // Aggregate stats
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
      studyName: config.study_name || 'Study Dashboard',
      summaries,
      stats,
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage({
  authenticated, studyName, error, adminCodeConfigured, summaries, stats,
}) {
  if (!authenticated) {
    return <AdminLogin studyName={studyName} error={error} adminCodeConfigured={adminCodeConfigured} />;
  }
  return <AdminDashboard studyName={studyName} summaries={summaries} stats={stats} />;
}

// ─── Login form ───────────────────────────────────────────────────────────────

function AdminLogin({ studyName, error, adminCodeConfigured }) {
  const [code, setCode] = useState('');

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
            <h1 className="text-2xl font-bold text-white">{studyName}</h1>
            <p className="text-slate-300 text-sm mt-1">Coordinator Dashboard</p>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Admin Access</h2>

            {!adminCodeConfigured && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 mb-4">
                No admin code is configured. Add <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">admin_code</code> to your Study Config tab.
              </div>
            )}

            {error === 'invalid' && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">
                Incorrect code — please try again.
              </div>
            )}

            <form action="/api/admin-auth" method="POST" className="space-y-4">
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Admin Code
                </label>
                <input
                  id="code"
                  name="code"
                  type="password"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Enter your admin code"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-500 text-slate-800 text-sm transition"
                />
              </div>
              <button
                type="submit"
                disabled={!code.trim()}
                className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold rounded-xl transition disabled:opacity-40"
              >
                Access Dashboard
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main admin dashboard ──────────────────────────────────────────────────────

function AdminDashboard({ studyName, summaries, stats }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | issues | comments | nodata

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
            <div>
              <h1 className="text-lg font-bold">{studyName}</h1>
              <p className="text-slate-400 text-xs mt-0.5">Coordinator Dashboard</p>
            </div>
            <a href="/" className="text-slate-400 hover:text-white text-xs transition">
              ← Participant Login
            </a>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

          {/* ── Stats cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Participants" value={stats.total} color="slate" />
            <StatCard label="Check-in Issues" value={stats.withIssues} color="red" alert={stats.withIssues > 0} />
            <StatCard label="Open Questions" value={stats.openComments} color="amber" alert={stats.openComments > 0} />
            <StatCard label="No Data Today" value={stats.noData} color="slate" />
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
            <div className="flex gap-2">
              {[
                { key: 'all',      label: `All (${stats.total})` },
                { key: 'issues',   label: `Issues (${stats.withIssues})` },
                { key: 'comments', label: `Open Q (${stats.openComments})` },
                { key: 'nodata',   label: `No Data (${stats.noData})` },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold transition ${
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

          {/* ── Participant table ── */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            {/* Table header */}
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

        </main>
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, color, alert }) {
  const colors = {
    red:   alert ? 'bg-red-50 border-red-100 text-red-700'    : 'bg-slate-50 border-slate-100 text-slate-600',
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
  const hasIssues = s.issueCount > 0;
  const hasComments = s.openComments > 0;

  return (
    <a
      href={`/dashboard/${encodeURIComponent(s.id)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="grid grid-cols-[1fr_1fr_1fr_1fr_80px_80px] gap-4 px-5 py-4 hover:bg-slate-50 transition items-center"
    >
      {/* Participant */}
      <div>
        <span className="text-sm font-semibold text-slate-800">{s.id}</span>
        {(s.firstName || s.lastName) && (
          <span className="text-xs text-slate-400 ml-2">{s.firstName} {s.lastName}</span>
        )}
      </div>

      {/* Phase */}
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

      {/* Progress */}
      <div className="flex items-center gap-2">
        {s.totalDays > 0 ? (
          <>
            <div className="flex-1 bg-slate-100 rounded-full h-1.5 max-w-[80px]">
              <div
                className="bg-brand-500 h-1.5 rounded-full"
                style={{ width: `${s.pct}%` }}
              />
            </div>
            <span className="text-xs font-medium text-slate-500 shrink-0">{s.pct}%</span>
          </>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </div>

      {/* Last check-in */}
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

      {/* Issues */}
      <div>
        {hasIssues ? (
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] rounded-full bg-red-100 text-red-600 text-xs font-bold px-1.5">
            {s.issueCount}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </div>

      {/* Open questions */}
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
