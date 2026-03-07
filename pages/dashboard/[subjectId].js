import Head from 'next/head';
import Link from 'next/link';
import {
  getParticipant,
  getStudyConfig,
  getPhases,
  getDailyStatusHistory,
  getCheckinFields,
  getComments,
  getShipments,
  deriveProgress,
  buildParticipantUrl,
} from '../../lib/sheets';
import ProgressTracker from '../../components/ProgressTracker';
import DailyStatusCard from '../../components/DailyStatusCard';
import CommentsSection from '../../components/CommentsSection';
import ShippingCard from '../../components/ShippingCard';
import Navbar from '../../components/Navbar';

export async function getServerSideProps({ params }) {
  const { subjectId } = params;

  const [participant, config, phases, history, checkinFields, comments, shipments] = await Promise.all([
    getParticipant(subjectId),
    getStudyConfig(),
    getPhases(),
    getDailyStatusHistory(subjectId),
    getCheckinFields(),
    getComments(subjectId),
    getShipments(subjectId),
  ]);

  if (!participant) {
    return { redirect: { destination: '/?error=not_found', permanent: false } };
  }

  const progress = deriveProgress(participant, phases);

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
}) {
  const studyName    = config.study_name        || 'Study Participant Dashboard';
  const contactEmail = config.contact_email     || '';
  const greeting     = config.dashboard_greeting || 'Welcome back';
  const firstName    = participant['First Name'] || 'Participant';

  const todayStatus        = history[0] || null;
  const hstUploadLink      = buildParticipantUrl(config.hst_upload_link || '', subjectId);
  const commentsConfigured = !!(config.comments_script_url || '').trim();

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

  return (
    <>
      <Head>
        <title>{`Dashboard — ${subjectId} | ${studyName}`}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="min-h-screen bg-slate-50">
        <Navbar
          studyName={studyName}
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
              </div>

              {totalDays > 0 && (
                <div className="bg-white/10 backdrop-blur rounded-xl p-4 text-center min-w-[140px]">
                  <div className="text-3xl font-bold">{pct}%</div>
                  <div className="text-brand-200 text-xs mt-1">Study Complete</div>
                  <div className="text-brand-100 text-xs mt-0.5">{completedDays} of {totalDays} nights done</div>
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

          {/* ── Shipping status ── */}
          <ShippingCard shipments={shipments} />

          {/* ── Daily status + HST upload ── */}
          <section id="daily-status">
            <h2 className="section-title">Today's Actions</h2>
            <p className="section-subtitle">Your device check-in status and daily tasks.</p>
            <DailyStatusCard
              todayStatus={todayStatus}
              history={history}
              checkinFields={checkinFields}
              config={config}
              hstUploadLink={hstUploadLink}
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
