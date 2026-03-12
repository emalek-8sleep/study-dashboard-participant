import Head from 'next/head';
import Link from 'next/link';
import { useState, useEffect } from 'react';

// Live clock — re-renders every minute, shows e.g. "Monday, March 9 · 3:42 PM"
function LiveDateTime() {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    function format() {
      const now = new Date();
      const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `${date} · ${time}`;
    }
    setDisplay(format());
    const id = setInterval(() => setDisplay(format()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!display) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-100 bg-white/10 px-2.5 py-1 rounded-full">
      <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      {display}
    </span>
  );
}
import ProgressTracker      from '../../components/ProgressTracker';
import DailyStatusCard      from '../../components/DailyStatusCard';
import TonightCard          from '../../components/TonightCard';
import CommentsSection      from '../../components/CommentsSection';
import ShippingCard         from '../../components/ShippingCard';
import ParticipantInfoCard  from '../../components/ParticipantInfoCard';
import Navbar               from '../../components/Navbar';

export async function getServerSideProps({ params, req }) {
  const { subjectId } = params;
  const { getSheetIdBySlug } = await import('../../lib/studies');
  const {
    getParticipant, getStudyConfig, getPhases, getDailyStatusHistory,
    getCheckinFields, getComments, getShipments, deriveProgress, buildParticipantUrl,
  } = await import('../../lib/sheets');

  // Determine which study's sheet to use based on the active_study cookie
  const cookies   = parseCookies(req.headers.cookie || '');
  const studySlug = decodeURIComponent(cookies['active_study'] || '');
  const sheetId   = getSheetIdBySlug(studySlug);

  const [participant, config, phases, history, checkinFields, comments, shipments] = await Promise.all([
    getParticipant(subjectId, sheetId),
    getStudyConfig(sheetId),
    getPhases(sheetId),
    getDailyStatusHistory(subjectId, sheetId),
    getCheckinFields(sheetId),
    getComments(subjectId, sheetId),
    getShipments(subjectId, sheetId),
  ]);

  if (!participant) {
    return { redirect: { destination: '/?error=not_found', permanent: false } };
  }

  const progress = deriveProgress(participant, phases);

  // Build URLs here (server-side) since buildParticipantUrl isn't available client-side
  const hstUploadLink = buildParticipantUrl(config.hst_upload_link || '', subjectId);

  // ── Tonight's instructions ──────────────────────────────────────────────────
  const currentPhase = progress.find((p) => p.status === 'inprogress') || progress.find((p) => p.status === 'pending');
  const tonightDay   = currentPhase?.days?.find((d) => d.status === 'inprogress') || currentPhase?.days?.find((d) => d.status === 'pending');
  const tonightInfo  = (currentPhase && tonightDay) ? {
    phaseName:        currentPhase.phaseName,
    phaseDescription: currentPhase.description || '',
    phaseGoal:        currentPhase.goal         || '',
    dayNumber:        tonightDay.dayNumber,
    dayLabel:         tonightDay.dayLabel        || '',
    completedDays:    currentPhase.completedDays,
    totalDays:        currentPhase.totalDays,
  } : null;

  // ── Break nights ────────────────────────────────────────────────────────────
  // "Break Nights" column in Participants tab — comma-separated dates (YYYY-MM-DD)
  const breakNightsRaw = participant['Break Nights'] || participant['break_nights'] || '';
  const breakNights    = breakNightsRaw.split(',').map((d) => d.trim()).filter(Boolean);
  const todayStr       = new Date().toISOString().split('T')[0];
  const isBreakNight   = breakNights.includes(todayStr);

  // ── Acknowledgments (last night's data review) ───────────────────────────────
  // "Acknowledgments" column lives on the Daily Status row for today,
  // not on the Participants tab — so each night's acks are naturally scoped.
  // Format: pipe-separated column names, e.g. "hrv|rhr"
  const todayRow = history[0] || null;
  const acksRaw  = todayRow ? (todayRow['Acknowledgments'] || '').toString().trim() : '';
  const initialAcknowledgments = acksRaw ? acksRaw.split('|').map(s => s.trim()).filter(Boolean) : [];

  // ── Tonight checklist (preparation steps from Phase Description) ─────────────
  // "Tonight Checklist" column lives on the same Daily Status row for today.
  // Format: pipe-separated step keys, e.g. "step_0|step_2"
  const checklistRaw = todayRow ? (todayRow['Tonight Checklist'] || '').toString().trim() : '';
  const initialTonightChecklist = checklistRaw ? checklistRaw.split('|').map(s => s.trim()).filter(Boolean) : [];

  // ── Sheet-driven settings ───────────────────────────────────────────────────
  // Set in Study Config tab:  show_full_history | true   and   show_tonight | false
  const showFullHistory = (config.show_full_history || '').toLowerCase() === 'true';
  const showTonight     = (config.show_tonight || 'true').toLowerCase() !== 'false';
  const showParticipantInfo = (config.show_participant_info || 'true').toLowerCase() !== 'false';

  return {
    props: {
      participant,
      config,
      progress,
      history,
      checkinFields,
      comments,
      shipments,
      subjectId,
      studySlug,
      hstUploadLink,
      tonightInfo,
      breakNights,
      isBreakNight,
      showFullHistory,
      showTonight,
      showParticipantInfo,
      initialAcknowledgments,
      initialTonightChecklist,
      todayStr,
    },
  };
}

export default function DashboardPage({
  participant,
  config,
  progress,
  history,
  checkinFields,
  comments,
  shipments,
  subjectId,
  studySlug,
  hstUploadLink,
  tonightInfo,
  breakNights,
  isBreakNight,
  showFullHistory,
  showTonight,
  showParticipantInfo,
  initialAcknowledgments,
  initialTonightChecklist,
  todayStr,
}) {
  const studyName    = config.study_name        || 'Study Participant Dashboard';
  const studyDisplay = config.study_short_name  || studyName;  // Used in navbar
  const contactEmail = config.contact_email     || '';
  const greeting     = config.dashboard_greeting || 'Welcome back';
  const firstName    = participant['First Name'] || 'Participant';

  const todayStatus        = history[0] || null;
  const commentsConfigured = !!(config.comments_script_url || '').trim();

  // Log login on page load — fire and forget, doesn't affect page rendering
  // Readable time computed client-side so it reflects the user's local timezone
  useEffect(() => {
    const readableTime = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    fetch('/api/log-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: subjectId, study: studySlug, readableTime }),
    }).catch(() => {}); // silently ignore errors
  }, [subjectId, studySlug]);

  // Attention: any check-in fields are invalid today
  const todayNeedsAttention = todayStatus &&
    checkinFields.some((f) => isInvalid(todayStatus[f['Column Name']] || ''));

  // Coordinator responded to a comment
  const hasNewResponse = comments.some(
    (c) => !!(c['Coordinator Response'] || '').trim() && !(c['Resolved'] || '').trim()
  );

  // Overall study completion
  const completedDays = progress.reduce((s, p) => s + p.completedDays, 0);
  const totalDays     = progress.reduce((s, p) => s + p.totalDays, 0);
  const pct           = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;
  const currentPhase  = progress.find((p) => p.status === 'inprogress') || progress.find((p) => p.status === 'pending');

  // Show setup wizard link when participant is in the configured setup phase
  const setupPhaseName = (config.setup_phase || '').trim().toLowerCase();
  const inSetupPhase   = setupPhaseName && currentPhase &&
    currentPhase.phaseName.toLowerCase().includes(setupPhaseName);
  const setupHref      = `/setup/${encodeURIComponent(subjectId)}`;

  return (
    <>
      <Head>
        <title>{`Dashboard — ${subjectId} | ${studyName}`}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="min-h-screen bg-slate-50">
        <Navbar
          studyName={studyDisplay}
          subjectId={subjectId}
          contactEmail={contactEmail}
          page="dashboard"
        />

        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">

          {/* ── Attention banner ── */}
          {todayNeedsAttention && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-800">Action needed from last night</p>
                <p className="text-xs text-amber-600">Check your daily status below — one or more items need your attention.</p>
              </div>
              <a href="#daily-status" className="ml-auto text-xs font-semibold text-amber-700 hover:text-amber-800 underline underline-offset-2 shrink-0">
                View ↓
              </a>
            </div>
          )}

          {/* ── Coordinator response banner ── */}
          {hasNewResponse && (
            <div className="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-2xl px-5 py-4">
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-brand-800">Your coordinator responded!</p>
                <p className="text-xs text-brand-600">You have a new response to one of your questions.</p>
              </div>
              <a href="#comments" className="ml-auto text-xs font-semibold text-brand-700 hover:text-brand-800 underline underline-offset-2 shrink-0">
                View ↓
              </a>
            </div>
          )}

          {/* ── Welcome header ── */}
          <div className="card bg-gradient-to-r from-brand-700 to-brand-500 text-white border-none">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-brand-200 text-sm font-medium mb-1">{greeting}</p>
                <h1 className="text-2xl font-bold">{firstName}</h1>
                <p className="text-brand-100 text-sm mt-1">Subject ID: {subjectId}</p>
                <div className="mt-2"><LiveDateTime /></div>
              </div>

              {totalDays > 0 && (
                <div className="bg-white/10 backdrop-blur rounded-xl p-4 text-center min-w-[140px]">
                  <div className="text-3xl font-bold">{pct}%</div>
                  <div className="text-brand-200 text-xs mt-1">Study Complete</div>
                  <div className="text-brand-100 text-xs mt-0.5">{completedDays} of {totalDays} valid nights done</div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-white/20 flex items-center justify-between gap-4">
              {currentPhase ? (
                <div className="flex items-center gap-2 text-sm text-brand-100">
                  <svg className="w-4 h-4 text-brand-200 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  {currentPhase.status === 'inprogress'
                    ? <span>Currently in <strong className="text-white">{currentPhase.phaseName}</strong></span>
                    : <span>Next up: <strong className="text-white">{currentPhase.phaseName}</strong></span>
                  }
                </div>
              ) : <span />}

              <div className="flex items-center gap-2 flex-wrap justify-end">
                {/* Setup wizard link — only shown when in the setup phase */}
                {inSetupPhase && (
                  <Link
                    href={setupHref}
                    className="inline-flex items-center gap-1.5 bg-white text-brand-700 hover:bg-brand-50 text-xs font-semibold px-3 py-1.5 rounded-lg transition shrink-0 shadow-sm"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    Setup Guide
                  </Link>
                )}

                {/* Resources shortcut */}
                <Link
                  href={`/resources/${encodeURIComponent(subjectId)}`}
                  className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Documents &amp; Troubleshooting
                </Link>
              </div>
            </div>
          </div>

          {/* ── Shipping status ── */}
          <ShippingCard shipments={shipments} />

          {/* ── Participant info ── */}
          {showParticipantInfo && <ParticipantInfoCard participantData={participant} />}

          {/* ── Tonight's instructions ── */}
          {showTonight && (tonightInfo || isBreakNight) && (
            <section id="tonight">
              <h2 className="section-title">Tonight</h2>
              <p className="section-subtitle">What's on for tonight based on your current phase.</p>
              <TonightCard
                tonightInfo={tonightInfo}
                isBreakNight={isBreakNight}
                subjectId={subjectId}
                studySlug={studySlug}
                todayStr={todayStr}
                initialTonightChecklist={initialTonightChecklist || []}
              />
            </section>
          )}

          {/* ── Daily status + HST upload ── */}
          <section id="daily-status">
            <h2 className="section-title">Prepare for Tonight</h2>
            <p className="section-subtitle">Review last night's check-in data and confirm you're ready for tonight.</p>
            <DailyStatusCard
              todayStatus={todayStatus}
              history={history}
              checkinFields={checkinFields}
              config={config}
              hstUploadLink={hstUploadLink}
              showFullHistory={showFullHistory}
              breakNights={breakNights}
              initialAcknowledgments={initialAcknowledgments || []}
              subjectId={subjectId}
              studySlug={studySlug || ''}
            />
          </section>

          {/* ── Progress tracker ── */}
          {progress.length > 0 && (
            <section id="progress">
              <h2 className="section-title">Your Progress</h2>
              <p className="section-subtitle">Track your study phases and nightly status.</p>
              <ProgressTracker progress={progress} />
            </section>
          )}

          {/* ── Comments / Q&A ── */}
          <section id="comments">
            <h2 className="section-title">Questions &amp; Comments</h2>
            <p className="section-subtitle">Leave a question for your study coordinator — they'll respond here.</p>
            <CommentsSection
              comments={comments}
              subjectId={subjectId}
              commentsConfigured={commentsConfigured}
            />
          </section>

          {/* ── Footer ── */}
          <footer className="text-center text-slate-400 text-xs py-4">
            <p>{studyName} · Participant Portal</p>
            {contactEmail && (
              <p className="mt-1">
                Questions?{' '}
                <a href={`mailto:${contactEmail}`} className="text-brand-500 hover:text-brand-600">
                  {contactEmail}
                </a>
              </p>
            )}
          </footer>
        </main>
      </div>
    </>
  );
}

function isInvalid(val) {
  const v = (val || '').toString().toLowerCase().trim();
  return v === 'no' || v === 'false' || v === 'incomplete' || v === 'invalid' || v === 'fail';
}

function parseCookies(cookieHeader) {
  const result = {};
  cookieHeader.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) result[key.trim()] = rest.join('=').trim();
  });
  return result;
}
