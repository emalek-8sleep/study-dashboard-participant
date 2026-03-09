import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export async function getServerSideProps() {
  const { getStudies, getSheetIdBySlug } = await import('../lib/studies');
  const { getStudyConfig }               = await import('../lib/sheets');

  const studies      = getStudies();
  const clientStudies = studies.map(({ name, slug }) => ({ name, slug }));

  // Fetch contact info from the first study's config so we can show it on the
  // "Don't know your ID?" and "Forgot PIN?" prompts — no personal data exposed.
  let contactEmail = '';
  let contactPhone = '';
  try {
    const firstSlug = studies[0]?.slug || '';
    const sheetId   = getSheetIdBySlug(firstSlug);
    if (sheetId) {
      const config = await getStudyConfig(sheetId);
      contactEmail = config.contact_email || '';
      contactPhone = config.contact_phone || '';
    }
  } catch { /* non-fatal — login page works without contact info */ }

  return { props: { studies: clientStudies, contactEmail, contactPhone } };
}

// ─── 4-digit PIN input — four individual boxes, auto-advance ─────────────────

function PinInput({ value, onChange, disabled = false, autoFocus = false }) {
  const refs = [useRef(), useRef(), useRef(), useRef()];
  const digits = (value + '    ').slice(0, 4).split('');

  useEffect(() => {
    if (autoFocus && refs[0].current) refs[0].current.focus();
  }, [autoFocus]);

  function handleKey(i, e) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i] !== ' ') {
        // Clear current digit
        const next = digits.map((d, idx) => (idx === i ? '' : d)).join('').replace(/ /g, '');
        onChange(next.slice(0, 4));
      } else if (i > 0) {
        // Move back and clear previous
        refs[i - 1].current?.focus();
        const next = digits.map((d, idx) => (idx === i - 1 ? '' : d)).join('').replace(/ /g, '');
        onChange(next.slice(0, 4));
      }
    } else if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      const next = digits.map((d, idx) => (idx === i ? e.key : d)).join('').replace(/ /g, '');
      const clamped = next.slice(0, 4);
      onChange(clamped);
      if (i < 3) refs[i + 1].current?.focus();
    }
  }

  function handlePaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (pasted) { onChange(pasted); refs[Math.min(pasted.length, 3)].current?.focus(); }
    e.preventDefault();
  }

  return (
    <div className="flex gap-3 justify-center" onPaste={handlePaste}>
      {[0, 1, 2, 3].map(i => (
        <input
          key={i}
          ref={refs[i]}
          type="tel"
          inputMode="numeric"
          maxLength={1}
          disabled={disabled}
          value={digits[i] === ' ' ? '' : digits[i]}
          onChange={() => {}}
          onKeyDown={(e) => handleKey(i, e)}
          onFocus={(e) => e.target.select()}
          className={`w-14 h-14 text-center text-2xl font-bold rounded-xl border-2 transition
            focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500
            ${disabled ? 'bg-slate-50 text-slate-400' : 'bg-white text-slate-800'}
            ${digits[i] && digits[i] !== ' ' ? 'border-brand-400' : 'border-slate-200'}
          `}
        />
      ))}
    </div>
  );
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  );
}

// ─── Error banner ────────────────────────────────────────────────────────────

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 text-red-600 bg-red-50 rounded-xl px-4 py-3 text-sm border border-red-100">
      <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
      <span>{message}</span>
    </div>
  );
}

// ─── Main login page ──────────────────────────────────────────────────────────

// ─── Contact info helper ─────────────────────────────────────────────────────

function ContactHelp({ contactEmail, contactPhone, label = 'contact your study coordinator' }) {
  const hasEmail = !!contactEmail;
  const hasPhone = !!contactPhone;
  if (!hasEmail && !hasPhone) {
    return <span>{label}</span>;
  }
  return (
    <span>
      reach out to your coordinator
      {hasPhone && (
        <> — text <a href={`sms:${contactPhone}`} className="text-brand-500 font-medium hover:underline">{contactPhone}</a></>
      )}
      {hasEmail && hasPhone && ' or '}
      {hasEmail && (
        <> email <a href={`mailto:${contactEmail}`} className="text-brand-500 font-medium hover:underline">{contactEmail}</a></>
      )}
    </span>
  );
}

// ─── Main login page ──────────────────────────────────────────────────────────

export default function LoginPage({ studies, contactEmail = '', contactPhone = '' }) {
  const router = useRouter();
  const multiStudy = studies.length > 1;

  // step: 'id' | 'pin-create' | 'pin-create-confirm' | 'pin-enter'
  const [step,        setStep]        = useState('id');
  const [showIdHelp,  setShowIdHelp]  = useState(false);
  const [subjectId,   setSubjectId]   = useState('');
  const [studySlug,   setStudySlug]   = useState(studies[0]?.slug || '');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [pin,         setPin]         = useState('');
  const [confirmPin,  setConfirmPin]  = useState('');

  const pageTitle = multiStudy ? 'Participant Portal' : 'Participant Portal';

  // ── Step 1: Verify subject ID, then check if PIN is set ───────────────────
  async function handleIdSubmit(e) {
    e.preventDefault();
    const trimmedId = subjectId.trim();
    if (!trimmedId) { setError('Please enter your Subject ID.'); return; }

    setLoading(true);
    setError('');

    try {
      // Verify subject ID exists
      const idParams = new URLSearchParams({ id: trimmedId, study: studySlug });
      const idRes  = await fetch(`/api/participant?${idParams.toString()}`);
      const idData = await idRes.json();

      if (!idData.found) {
        setError("We couldn't find that Subject ID. Please double-check and try again, or contact your study coordinator.");
        setLoading(false);
        return;
      }

      // Check if PIN is already set
      const pinParams = new URLSearchParams({ id: trimmedId, study: studySlug });
      const pinRes  = await fetch(`/api/pin?${pinParams.toString()}`);
      const pinData = await pinRes.json();

      setLoading(false);
      setPin('');
      setConfirmPin('');

      if (pinData.hasPin) {
        setStep('pin-enter');
      } else {
        setStep('pin-create');
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  // ── Step 2a: Create PIN (first visit) ─────────────────────────────────────
  async function handlePinCreate(e) {
    e.preventDefault();
    if (pin.length !== 4) { setError('Please enter a 4-digit PIN.'); return; }

    // If we haven't confirmed yet, move to confirm step
    if (step === 'pin-create') {
      setStep('pin-create-confirm');
      setConfirmPin('');
      setError('');
      return;
    }

    // Confirm step — check they match
    if (confirmPin !== pin) {
      setError("PINs don't match. Please try again.");
      setConfirmPin('');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res  = await fetch('/api/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: subjectId.trim(), study: studySlug, action: 'set', pin }),
      });
      const data = await res.json();

      if (data.success) {
        router.push(`/dashboard/${encodeURIComponent(subjectId.trim())}`);
      } else {
        setError(data.error || 'Could not save PIN. Please try again.');
        setLoading(false);
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  // ── Step 2b: Enter existing PIN ───────────────────────────────────────────
  async function handlePinVerify(e) {
    if (e) e.preventDefault();
    if (pin.length !== 4) return;

    setLoading(true);
    setError('');

    try {
      const res  = await fetch('/api/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: subjectId.trim(), study: studySlug, action: 'verify', pin }),
      });
      const data = await res.json();

      if (data.success) {
        router.push(`/dashboard/${encodeURIComponent(subjectId.trim())}`);
      } else {
        setError(data.error || 'Incorrect PIN. Please try again.');
        setPin('');
        setLoading(false);
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setPin('');
      setLoading(false);
    }
  }

  // Auto-submit verify when all 4 digits entered
  useEffect(() => {
    if (step === 'pin-enter' && pin.length === 4 && !loading) {
      handlePinVerify();
    }
  }, [pin, step]);

  // ─ Render helpers ─────────────────────────────────────────────────────────

  function goBack() {
    setStep(step === 'pin-create-confirm' ? 'pin-create' : 'id');
    setPin('');
    setConfirmPin('');
    setError('');
  }

  const isCreateConfirm = step === 'pin-create-confirm';
  const activePin       = isCreateConfirm ? confirmPin : pin;
  const setActivePin    = isCreateConfirm ? setConfirmPin : setPin;

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content="Study participant portal" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-brand-950 via-brand-800 to-brand-600 flex items-center justify-center p-4">
        {/* Background texture */}
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
        }} />

        <div className="relative w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Participant Portal</h1>
            <p className="text-brand-200 mt-2 text-sm">Eight Sleep Research Studies</p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-2xl p-8">

            {/* ── Step 1: Subject ID ────────────────────────────────────── */}
            {step === 'id' && (
              <>
                <h2 className="text-xl font-semibold text-slate-800 mb-1">Welcome</h2>
                <p className="text-slate-500 text-sm mb-6">
                  {multiStudy
                    ? 'Select your study and enter your Subject ID to get started.'
                    : 'Enter your Subject ID to view your study progress.'}
                </p>

                <form onSubmit={handleIdSubmit} className="space-y-4">
                  {multiStudy && (
                    <div>
                      <label htmlFor="studySelect" className="block text-sm font-medium text-slate-700 mb-1.5">Study</label>
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

                  <div>
                    <label htmlFor="subjectId" className="block text-sm font-medium text-slate-700 mb-1.5">Subject ID</label>
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

                  <ErrorBanner message={error} />

                  <button
                    type="submit"
                    disabled={loading || !subjectId.trim()}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    {loading ? <><Spinner /> Checking...</> : <>Continue <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg></>}
                  </button>
                </form>

                {/* Don't know your ID? */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => setShowIdHelp(!showIdHelp)}
                    className="text-xs text-slate-400 hover:text-slate-600 transition w-full text-center"
                  >
                    {showIdHelp ? '▲ Hide' : "Don't know your Subject ID?"}
                  </button>
                  {showIdHelp && (
                    <div className="mt-3 bg-slate-50 rounded-xl px-4 py-3 text-xs text-slate-600 space-y-1.5">
                      <p>Your Subject ID was included in your enrollment email when you joined the study.</p>
                      <p>
                        Can't find it? <ContactHelp contactEmail={contactEmail} contactPhone={contactPhone} /> and they'll send it to you.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── Step 2a: Create PIN ───────────────────────────────────── */}
            {(step === 'pin-create' || step === 'pin-create-confirm') && (
              <>
                <button onClick={goBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 mb-5 transition">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  {isCreateConfirm ? 'Re-enter PIN' : 'Back'}
                </button>

                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-semibold text-slate-800 mb-1">
                    {isCreateConfirm ? 'Confirm your PIN' : 'Create a PIN'}
                  </h2>
                  <p className="text-slate-500 text-sm">
                    {isCreateConfirm
                      ? 'Enter the same 4-digit PIN again to confirm.'
                      : "You'll use this 4-digit PIN to log in each time. If you forget it, your coordinator can look it up."}
                  </p>
                </div>

                <form onSubmit={handlePinCreate} className="space-y-5">
                  <PinInput
                    value={activePin}
                    onChange={(v) => { setActivePin(v); setError(''); }}
                    disabled={loading}
                    autoFocus={true}
                  />

                  <ErrorBanner message={error} />

                  <button
                    type="submit"
                    disabled={loading || activePin.length !== 4}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    {loading
                      ? <><Spinner /> Saving...</>
                      : isCreateConfirm
                        ? 'Set PIN & Open Dashboard'
                        : 'Continue →'}
                  </button>
                </form>
              </>
            )}

            {/* ── Step 2b: Enter existing PIN ───────────────────────────── */}
            {step === 'pin-enter' && (
              <>
                <button onClick={goBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 mb-5 transition">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  Back
                </button>

                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-semibold text-slate-800 mb-1">Enter your PIN</h2>
                  <p className="text-slate-500 text-sm">
                    Welcome back, <span className="font-medium text-slate-700">{subjectId.trim()}</span>. Enter your 4-digit PIN to continue.
                  </p>
                </div>

                <form onSubmit={handlePinVerify} className="space-y-5">
                  <PinInput
                    value={pin}
                    onChange={(v) => { setPin(v); setError(''); }}
                    disabled={loading}
                    autoFocus={true}
                  />

                  {loading && (
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                      <Spinner /> Verifying...
                    </div>
                  )}

                  <ErrorBanner message={error} />
                </form>

                <p className="text-center text-xs text-slate-400 mt-4">
                  Forgot your PIN? <ContactHelp contactEmail={contactEmail} contactPhone={contactPhone} label="contact your coordinator" /> — they can look it up for you.
                </p>
              </>
            )}
          </div>

          <p className="text-center text-brand-300 text-xs mt-6">
            This portal is for study participants only. All data is confidential.
          </p>
          <div className="text-center mt-4">
            <a href="/admin" className="text-brand-400 hover:text-brand-200 text-xs transition font-medium">
              Coordinator Access →
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
