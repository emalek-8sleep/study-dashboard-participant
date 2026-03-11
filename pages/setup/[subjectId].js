/**
 * /setup/[subjectId] — Device Setup Wizard
 *
 * Step-by-step guide for participants setting up their study equipment.
 * Steps are pulled from the "Setup Steps" sheet tab — add/edit/reorder freely.
 *
 * Sheet columns: Step Number | Step Title | Description | Image URL | Tips
 * Tips are pipe-separated: "Keep pod flat | Avoid folding"
 */

import Head   from 'next/head';
import { useState } from 'react';
import Link   from 'next/link';
import Navbar from '../../components/Navbar';

export async function getServerSideProps({ params, req }) {
  const { subjectId } = params;
  const { getSheetIdBySlug } = await import('../../lib/studies');
  const { getParticipant, getStudyConfig, getSetupSteps } = await import('../../lib/sheets');

  // Determine which study's sheet to use based on the active_study cookie
  const cookies   = parseCookies(req.headers.cookie || '');
  const studySlug = decodeURIComponent(cookies['active_study'] || '');
  const sheetId   = getSheetIdBySlug(studySlug);

  const [participant, config, steps] = await Promise.all([
    getParticipant(subjectId, sheetId),
    getStudyConfig(sheetId),
    getSetupSteps(sheetId),
  ]);

  if (!participant) {
    return { redirect: { destination: '/?error=not_found', permanent: false } };
  }

  return {
    props: { config, steps, subjectId },
  };
}

export default function SetupPage({ config, steps, subjectId }) {
  const studyName    = config.study_name    || 'Study Participant Dashboard';
  const studyDisplay = config.study_short_name || studyName;  // Used in navbar
  const contactEmail = config.contact_email || '';

  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted]     = useState(false);
  const [checked, setChecked]         = useState(() => Array(steps.length).fill(false));

  const step       = steps[currentStep];
  const isFirst    = currentStep === 0;
  const isLast     = currentStep === steps.length - 1;
  const tips       = step ? (step['Tips'] || '').split('|').map((t) => t.trim()).filter(Boolean) : [];
  const imageUrl   = step ? (step['Image URL'] || '').trim() : '';
  const allChecked = checked.every(Boolean);

  function markChecked(i) {
    setChecked((prev) => {
      const next = [...prev];
      next[i] = true;
      return next;
    });
  }

  function goNext() {
    markChecked(currentStep);
    if (isLast) {
      setCompleted(true);
    } else {
      setCurrentStep((s) => s + 1);
    }
  }

  function goPrev() {
    setCurrentStep((s) => s - 1);
  }

  if (steps.length === 0) {
    return (
      <>
        <Head><title>Setup · {studyName}</title></Head>
        <div className="min-h-screen bg-slate-50">
          <Navbar studyName={studyDisplay} subjectId={subjectId} contactEmail={contactEmail} page="dashboard" />
          <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-400">
            <p className="text-lg font-semibold text-slate-600">Setup guide coming soon</p>
            <p className="text-sm mt-2">Your coordinator hasn't added setup steps yet. Check back shortly!</p>
            <Link href={`/dashboard/${encodeURIComponent(subjectId)}`}
              className="inline-block mt-6 text-brand-600 hover:text-brand-700 text-sm font-medium">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </>
    );
  }

  // ── Completion screen ──────────────────────────────────────────────────────
  if (completed) {
    return (
      <>
        <Head><title>Setup Complete · {studyName}</title></Head>
        <div className="min-h-screen bg-slate-50">
          <Navbar studyName={studyDisplay} subjectId={subjectId} contactEmail={contactEmail} page="dashboard" />
          <div className="max-w-2xl mx-auto px-4 py-16 text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-100 mb-6">
              <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Setup complete!</h1>
            <p className="text-slate-500 mt-3 max-w-md mx-auto">
              Great work — your equipment is all set up. Head back to your dashboard to see your study schedule and nightly check-ins.
            </p>
            {contactEmail && (
              <p className="text-sm text-slate-400 mt-3">
                If anything didn't go as expected, reach out to your coordinator at{' '}
                <a href={`mailto:${contactEmail}`} className="text-brand-500 hover:text-brand-600">{contactEmail}</a>.
              </p>
            )}
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href={`/dashboard/${encodeURIComponent(subjectId)}`}
                className="btn-primary inline-flex items-center justify-center gap-2 w-full sm:w-auto py-3 sm:py-2.5"
              >
                Go to My Dashboard
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
              <button
                onClick={() => { setCurrentStep(0); setCompleted(false); }}
                className="px-5 py-2.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition"
              >
                Review steps again
              </button>
            </div>

            {/* Step summary */}
            <div className="mt-10 text-left max-w-md mx-auto">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Steps completed</p>
              <div className="space-y-2">
                {steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm text-slate-600">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <svg className="w-3 h-3 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </span>
                    {s['Step Title']}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Wizard ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>{`Setup: Step ${currentStep + 1} · ${studyName}`}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="min-h-screen bg-slate-50">
        <Navbar studyName={studyName} subjectId={subjectId} contactEmail={contactEmail} page="dashboard" />

        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">

          {/* ── Header ── */}
          <div className="mb-6">
            <Link
              href={`/dashboard/${encodeURIComponent(subjectId)}`}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition mb-4"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Dashboard
            </Link>
            <h1 className="text-xl font-bold text-slate-800">Device Setup Guide</h1>
            <p className="text-slate-400 text-sm mt-0.5">Follow each step carefully before your first night.</p>
          </div>

          {/* ── Progress dots ── */}
          <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
            {steps.map((s, i) => (
              <button
                key={i}
                onClick={() => setCurrentStep(i)}
                className={`flex items-center gap-1.5 transition ${i === currentStep ? 'opacity-100' : 'opacity-60 hover:opacity-80'}`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition ${
                  checked[i]
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : i === currentStep
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'bg-white border-slate-200 text-slate-400'
                }`}>
                  {checked[i]
                    ? <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    : i + 1
                  }
                </span>
                {i < steps.length - 1 && (
                  <span className={`hidden sm:block w-6 h-px ${checked[i] ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                )}
              </button>
            ))}
            <span className="ml-auto text-xs text-slate-400 font-medium">
              Step {currentStep + 1} of {steps.length}
            </span>
          </div>

          {/* ── Progress bar ── */}
          <div className="h-1.5 bg-slate-100 rounded-full mb-6 overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-500"
              style={{ width: `${((currentStep + (checked[currentStep] ? 1 : 0)) / steps.length) * 100}%` }}
            />
          </div>

          {/* ── Step card ── */}
          <div className="card border-slate-100 mb-4">
            {/* Step label */}
            <div className="flex items-center gap-2 mb-4">
              <span className="w-7 h-7 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                {currentStep + 1}
              </span>
              <h2 className="text-lg font-bold text-slate-800">{step['Step Title']}</h2>
            </div>

            {/* Image */}
            {imageUrl && (
              <div className="rounded-xl overflow-hidden mb-4 bg-slate-100">
                <img
                  src={imageUrl}
                  alt={step['Step Title']}
                  className="w-full object-cover max-h-72"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>
            )}

            {/* Description */}
            {step['Description'] && (
              <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-wrap mb-4">
                {step['Description']}
              </p>
            )}

            {/* Tips */}
            {tips.length > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Tips
                </p>
                <ul className="space-y-1.5">
                  {tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-amber-800">
                      <span className="mt-0.5 shrink-0">·</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* ── Navigation ── */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
            <button
              onClick={goPrev}
              disabled={isFirst}
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-3 sm:py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Previous
            </button>

            <button
              onClick={goNext}
              className="btn-primary inline-flex items-center justify-center gap-2 w-full sm:w-auto py-3 sm:py-2.5"
            >
              {isLast ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Complete Setup
                </>
              ) : (
                <>
                  Next Step
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </button>
          </div>

          {/* ── Step list sidebar (all steps at a glance) ── */}
          <div className="mt-8 border-t border-slate-100 pt-6">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">All steps</p>
            <div className="space-y-1.5">
              {steps.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentStep(i)}
                  className={`w-full flex items-center gap-3 px-3 py-3 sm:py-2 rounded-lg text-left transition text-sm ${
                    i === currentStep
                      ? 'bg-brand-50 text-brand-700 font-semibold'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    checked[i]
                      ? 'bg-emerald-100 text-emerald-600'
                      : i === currentStep
                        ? 'bg-brand-100 text-brand-600'
                        : 'bg-slate-100 text-slate-400'
                  }`}>
                    {checked[i]
                      ? <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      : i + 1
                    }
                  </span>
                  {s['Step Title']}
                </button>
              ))}
            </div>
          </div>

        </main>
      </div>
    </>
  );
}

function parseCookies(cookieHeader) {
  const result = {};
  cookieHeader.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) result[key.trim()] = rest.join('=').trim();
  });
  return result;
}
