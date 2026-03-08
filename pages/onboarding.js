/**
 * /onboarding — Study Sheet Generator
 *
 * A 3-step wizard that helps study coordinators generate a pre-populated
 * Google Sheets template from their study documents (IRB, consent forms, etc.)
 *
 * Step 1: Upload/paste study documents
 * Step 2: Review and edit Claude's extracted data
 * Step 3: Download the .xlsx template
 */

import { useState, useRef } from 'react';
import Head from 'next/head';

// ─── Default form state ────────────────────────────────────────────────────────

const EMPTY_PHASE = () => ({
  phaseNumber:  1,
  phaseName:    '',
  durationDays: 7,
  description:  '',
  goal:         '',
});

const EMPTY_FIELD = () => ({
  fieldLabel:   '',
  columnName:   '',
  invalidTips:  '',
});

const EMPTY_STEP = () => ({
  stepNumber:   1,
  stepTitle:    '',
  description:  '',
  tips:         '',
});

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const [step, setStep]           = useState(1); // 1 | 2 | 3
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [skippedAI, setSkippedAI] = useState(false);
  const [formData, setFormData]   = useState({
    studyName:     '',
    contactEmail:  '',
    phases:        [{ ...EMPTY_PHASE() }],
    checkinFields: [{ ...EMPTY_FIELD() }],
    setupSteps:    [],
  });

  // Document inputs
  const [pastedText,    setPastedText]    = useState('');
  const [googleDocsUrl, setGoogleDocsUrl] = useState('');
  const [files,         setFiles]         = useState([]); // [{ name, base64, type }]
  const fileInputRef = useRef(null);

  // ── File handling ──────────────────────────────────────────────────────────

  async function handleFileChange(e) {
    const selected = Array.from(e.target.files || []);
    const newFiles = await Promise.all(selected.map(async (file) => {
      const base64 = await fileToBase64(file);
      const type   = file.name.endsWith('.pdf')  ? 'pdf'
                   : file.name.endsWith('.docx') ? 'docx'
                   : 'unknown';
      return { name: file.name, base64, type };
    }));
    setFiles((prev) => [...prev, ...newFiles.filter((f) => f.type !== 'unknown')]);
    e.target.value = '';
  }

  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Step 1 → 2: Extract with Claude ───────────────────────────────────────

  async function handleExtract(e) {
    e.preventDefault();
    const hasContent = pastedText.trim() || googleDocsUrl.trim() || files.length > 0;
    if (!hasContent) {
      setError('Please add at least one document — paste text, upload a file, or provide a Google Docs link.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const body = {
        text:         pastedText.trim() || undefined,
        googleDocsUrl: googleDocsUrl.trim() || undefined,
      };

      // Send files as arrays — never concatenate base64 strings
      const pdfFiles  = files.filter((f) => f.type === 'pdf').map((f) => f.base64);
      const docxFiles = files.filter((f) => f.type === 'docx').map((f) => f.base64);
      if (pdfFiles.length  > 0) body.pdfFiles  = pdfFiles;
      if (docxFiles.length > 0) body.docxFiles = docxFiles;

      const res  = await fetch('/api/extract-study', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Extraction failed');

      // Merge extracted data into formData, keeping defaults for missing fields
      setFormData({
        studyName:    data.studyName    || '',
        contactEmail: data.contactEmail || '',
        phases: (data.phases?.length ? data.phases : [EMPTY_PHASE()]).map((p, i) => ({
          phaseNumber:  p.phaseNumber  ?? i + 1,
          phaseName:    p.phaseName    || '',
          durationDays: p.durationDays || 7,
          description:  p.description  || '',
          goal:         p.goal         || '',
        })),
        checkinFields: (data.checkinFields?.length ? data.checkinFields : [EMPTY_FIELD()]).map((f) => ({
          fieldLabel:  f.fieldLabel  || '',
          columnName:  f.columnName  || f.fieldLabel || '',
          invalidTips: f.invalidTips || '',
        })),
        setupSteps: (data.setupSteps || []).map((s, i) => ({
          stepNumber:  s.stepNumber  ?? i + 1,
          stepTitle:   s.stepTitle   || '',
          description: s.description || '',
          tips:        s.tips        || '',
        })),
      });

      setStep(2);
    } catch (err) {
      setError(err.message || 'Something went wrong during extraction.');
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2 → 3: Generate XLSX ──────────────────────────────────────────────

  async function handleGenerate(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/generate-sheet', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Sheet generation failed');
      }

      // Trigger file download
      const blob     = await res.blob();
      const url      = URL.createObjectURL(blob);
      const filename = `${slugify(formData.studyName || 'study')}-template.xlsx`;
      const a        = document.createElement('a');
      a.href         = url;
      a.download     = filename;
      a.click();
      URL.revokeObjectURL(url);

      setStep(3);
    } catch (err) {
      setError(err.message || 'Something went wrong generating the sheet.');
    } finally {
      setLoading(false);
    }
  }

  // ── Form helpers ───────────────────────────────────────────────────────────

  function updatePhase(idx, field, value) {
    setFormData((prev) => {
      const phases = [...prev.phases];
      phases[idx]  = { ...phases[idx], [field]: value };
      // Re-number phases automatically
      phases.forEach((p, i) => { p.phaseNumber = i + 1; });
      return { ...prev, phases };
    });
  }

  function addPhase() {
    setFormData((prev) => ({
      ...prev,
      phases: [...prev.phases, { ...EMPTY_PHASE(), phaseNumber: prev.phases.length + 1 }],
    }));
  }

  function removePhase(idx) {
    setFormData((prev) => {
      const phases = prev.phases.filter((_, i) => i !== idx);
      phases.forEach((p, i) => { p.phaseNumber = i + 1; });
      return { ...prev, phases };
    });
  }

  function updateField(idx, key, value) {
    setFormData((prev) => {
      const checkinFields = [...prev.checkinFields];
      checkinFields[idx]  = { ...checkinFields[idx], [key]: value };
      return { ...prev, checkinFields };
    });
  }

  function addField() {
    setFormData((prev) => ({ ...prev, checkinFields: [...prev.checkinFields, EMPTY_FIELD()] }));
  }

  function removeField(idx) {
    setFormData((prev) => ({
      ...prev,
      checkinFields: prev.checkinFields.filter((_, i) => i !== idx),
    }));
  }

  function updateSetupStep(idx, key, value) {
    setFormData((prev) => {
      const setupSteps = [...prev.setupSteps];
      setupSteps[idx]  = { ...setupSteps[idx], [key]: value };
      return { ...prev, setupSteps };
    });
  }

  function addSetupStep() {
    setFormData((prev) => ({
      ...prev,
      setupSteps: [...prev.setupSteps, { ...EMPTY_STEP(), stepNumber: prev.setupSteps.length + 1 }],
    }));
  }

  function removeSetupStep(idx) {
    setFormData((prev) => {
      const steps = prev.setupSteps.filter((_, i) => i !== idx);
      steps.forEach((s, i) => { s.stepNumber = i + 1; });
      return { ...prev, setupSteps: steps };
    });
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Head>
        <title>Study Sheet Generator · Onboarding</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="min-h-screen bg-slate-50">
        {/* Header */}
        <header className="bg-white border-b border-slate-100 px-6 py-4">
          <div className="max-w-3xl mx-auto flex items-center gap-4">
            <a href="/" className="text-slate-400 hover:text-slate-600 text-sm transition">← Portal</a>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-slate-800">Study Sheet Generator</h1>
              <p className="text-xs text-slate-400">Upload your study docs — we'll build the Google Sheet template.</p>
            </div>
            {/* Step indicators */}
            <div className="hidden sm:flex items-center gap-2 text-xs font-medium">
              {[
                { n: 1, label: 'Upload' },
                { n: 2, label: 'Review' },
                { n: 3, label: 'Download' },
              ].map(({ n, label }, i) => (
                <div key={n} className="flex items-center gap-2">
                  {i > 0 && <span className="text-slate-200">→</span>}
                  <span className={`flex items-center gap-1.5 ${step === n ? 'text-brand-600' : step > n ? 'text-slate-400' : 'text-slate-300'}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                      step > n  ? 'bg-emerald-100 text-emerald-600' :
                      step === n ? 'bg-brand-600 text-white' :
                      'bg-slate-100 text-slate-400'
                    }`}>
                      {step > n ? '✓' : n}
                    </span>
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">

          {/* Error banner */}
          {error && (
            <div className="mb-6 flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
              <svg className="w-4 h-4 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* ── STEP 1: Upload ──────────────────────────────────────────────── */}
          {step === 1 && (
            <form onSubmit={handleExtract} className="space-y-6">
              <div className="card">
                <h2 className="text-lg font-bold text-slate-800 mb-1">Add your study documents</h2>
                <p className="text-slate-500 text-sm mb-6">
                  Paste text from your IRB protocol, informed consent form, or any other study docs.
                  Claude will extract the structure and pre-fill your sheet template.
                </p>

                {/* File upload */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Upload files</label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-200 hover:border-brand-300 rounded-xl px-6 py-8 text-center cursor-pointer transition group"
                  >
                    <svg className="w-8 h-8 mx-auto mb-3 text-slate-300 group-hover:text-brand-400 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-sm text-slate-500 group-hover:text-slate-700 transition">
                      Click to upload <span className="font-medium text-slate-700">PDF</span> or <span className="font-medium text-slate-700">Word (.docx)</span> files
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Multiple files supported</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {files.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {files.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded uppercase ${f.type === 'pdf' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                            {f.type}
                          </span>
                          <span className="text-sm text-slate-700 flex-1 truncate">{f.name}</span>
                          <button type="button" onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500 transition ml-auto shrink-0">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Google Docs URL */}
                <div className="mb-4">
                  <label htmlFor="gdocsUrl" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Or paste a Google Docs link
                    <span className="text-slate-400 font-normal ml-1">(must be publicly viewable)</span>
                  </label>
                  <input
                    id="gdocsUrl"
                    type="url"
                    value={googleDocsUrl}
                    onChange={(e) => setGoogleDocsUrl(e.target.value)}
                    placeholder="https://docs.google.com/document/d/..."
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition"
                  />
                </div>

                {/* Paste text */}
                <div className="mb-6">
                  <label htmlFor="pastedText" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Or paste text directly
                  </label>
                  <textarea
                    id="pastedText"
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    rows={8}
                    placeholder="Paste sections from your IRB protocol, consent form, or study overview here…"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition resize-y"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Extracting with Claude…
                    </>
                  ) : (
                    <>
                      Extract & Review
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </>
                  )}
                </button>

                <div className="text-center mt-4">
                  <button
                    type="button"
                    onClick={() => { setSkippedAI(true); setError(''); setStep(2); }}
                    className="text-sm text-slate-500 hover:text-slate-700 transition"
                  >
                    Skip AI — fill out the form manually instead
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* ── STEP 2: Review ──────────────────────────────────────────────── */}
          {step === 2 && (
            <form onSubmit={handleGenerate} className="space-y-6">

              {/* Extraction / manual notice */}
              {skippedAI ? (
                <div className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-600">
                  <svg className="w-5 h-5 shrink-0 mt-0.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span>Fill in your study details below, then hit <strong>Generate Sheet</strong> to download your template.</span>
                </div>
              ) : (
                <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm text-emerald-800">
                  <svg className="w-5 h-5 shrink-0 mt-0.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Claude extracted the details below. Review and edit anything that doesn't look right, then generate your sheet.</span>
                </div>
              )}

              {/* Study Details */}
              <section className="card">
                <h3 className="text-base font-bold text-slate-800 mb-4">Study Details</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Study Name</label>
                    <input
                      type="text"
                      value={formData.studyName}
                      onChange={(e) => setFormData((p) => ({ ...p, studyName: e.target.value }))}
                      placeholder="e.g. Full Moon Study"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Contact Email</label>
                    <input
                      type="email"
                      value={formData.contactEmail}
                      onChange={(e) => setFormData((p) => ({ ...p, contactEmail: e.target.value }))}
                      placeholder="coordinator@eightsleep.com"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition"
                    />
                  </div>
                </div>
              </section>

              {/* Study Phases */}
              <section className="card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Study Phases</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Each phase generates its own daily tracking columns in the sheet.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {formData.phases.map((phase, idx) => (
                    <div key={idx} className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Phase {idx + 1}</span>
                        {formData.phases.length > 1 && (
                          <button type="button" onClick={() => removePhase(idx)}
                            className="text-slate-400 hover:text-red-500 transition text-xs flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid sm:grid-cols-3 gap-3 mb-3">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Phase Name</label>
                          <input type="text" value={phase.phaseName}
                            onChange={(e) => updatePhase(idx, 'phaseName', e.target.value)}
                            placeholder="e.g. Baseline"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Duration (days)</label>
                          <input type="number" min="1" max="365" value={phase.durationDays}
                            onChange={(e) => updatePhase(idx, 'durationDays', Number(e.target.value))}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition"
                          />
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                          <textarea rows={2} value={phase.description}
                            onChange={(e) => updatePhase(idx, 'description', e.target.value)}
                            placeholder="What participants do during this phase"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition resize-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Goal</label>
                          <textarea rows={2} value={phase.goal}
                            onChange={(e) => updatePhase(idx, 'goal', e.target.value)}
                            placeholder="What's being measured or achieved"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition resize-none"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button type="button" onClick={addPhase}
                  className="mt-4 flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium transition">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Phase
                </button>
              </section>

              {/* Daily Check-in Fields */}
              <section className="card">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-slate-800">Daily Check-in Fields</h3>
                  <p className="text-xs text-slate-400 mt-0.5">These become columns in the Daily Status tab and appear on participant dashboards.</p>
                </div>

                <div className="space-y-3">
                  {formData.checkinFields.map((field, idx) => (
                    <div key={idx} className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Field {idx + 1}</span>
                        {formData.checkinFields.length > 1 && (
                          <button type="button" onClick={() => removeField(idx)}
                            className="text-slate-400 hover:text-red-500 transition text-xs flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Display Label</label>
                          <input type="text" value={field.fieldLabel}
                            onChange={(e) => updateField(idx, 'fieldLabel', e.target.value)}
                            placeholder="e.g. Sleep Quality"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Column Name <span className="text-slate-400 font-normal">(in sheet)</span></label>
                          <input type="text" value={field.columnName}
                            onChange={(e) => updateField(idx, 'columnName', e.target.value)}
                            placeholder="e.g. Sleep Quality"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">What does an invalid response look like?</label>
                        <input type="text" value={field.invalidTips}
                          onChange={(e) => updateField(idx, 'invalidTips', e.target.value)}
                          placeholder='e.g. "Score below 3 is a concern"'
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <button type="button" onClick={addField}
                  className="mt-4 flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium transition">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Field
                </button>
              </section>

              {/* Setup Steps (collapsible) */}
              <section className="card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Device Setup Steps <span className="text-slate-400 font-normal text-sm ml-1">(optional)</span></h3>
                    <p className="text-xs text-slate-400 mt-0.5">Step-by-step guide shown to participants when setting up their device.</p>
                  </div>
                  <button type="button" onClick={addSetupStep}
                    className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 font-medium transition shrink-0">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Step
                  </button>
                </div>

                {formData.setupSteps.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No setup steps — skip if not applicable.</p>
                ) : (
                  <div className="space-y-3">
                    {formData.setupSteps.map((step, idx) => (
                      <div key={idx} className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Step {idx + 1}</span>
                          <button type="button" onClick={() => removeSetupStep(idx)}
                            className="text-slate-400 hover:text-red-500 transition text-xs flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Remove
                          </button>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Step Title</label>
                            <input type="text" value={step.stepTitle}
                              onChange={(e) => updateSetupStep(idx, 'stepTitle', e.target.value)}
                              placeholder="e.g. Connect the Hub"
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Instructions</label>
                            <textarea rows={2} value={step.description}
                              onChange={(e) => updateSetupStep(idx, 'description', e.target.value)}
                              placeholder="Detailed instructions for this step"
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition resize-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Tips <span className="text-slate-400 font-normal">(pipe-separated: tip 1 | tip 2)</span></label>
                            <input type="text" value={step.tips}
                              onChange={(e) => updateSetupStep(idx, 'tips', e.target.value)}
                              placeholder="e.g. Keep cables tidy | Avoid bending the tube"
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 text-sm transition"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Actions */}
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3">
                <button type="button" onClick={() => { setStep(1); setSkippedAI(false); }}
                  className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition w-full sm:w-auto">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
                <button type="submit" disabled={loading}
                  className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto py-3 sm:py-2.5">
                  {loading ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Generating…
                    </>
                  ) : (
                    <>
                      Generate Sheet
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* ── STEP 3: Done ────────────────────────────────────────────────── */}
          {step === 3 && (
            <div className="card text-center py-10">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 mb-5">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Your sheet is downloading!</h2>
              <p className="text-slate-500 text-sm max-w-md mx-auto mb-8">
                If the download didn't start automatically, click the button below.
              </p>

              <button
                onClick={handleGenerate}
                disabled={loading}
                className="btn-primary inline-flex items-center gap-2 mb-10"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Again
              </button>

              {/* Next steps */}
              <div className="text-left max-w-sm mx-auto border border-slate-100 rounded-2xl p-5 bg-slate-50">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">Next steps</p>
                <div className="space-y-3">
                  {[
                    { n: 1, title: 'Upload to Google Sheets', detail: 'File → Import → Upload the .xlsx file' },
                    { n: 2, title: 'Share the sheet', detail: 'Share → Anyone with link can view' },
                    { n: 3, title: 'Publish to web', detail: 'File → Share → Publish to web → Publish' },
                    { n: 4, title: 'Add Sheet ID to Vercel', detail: 'Copy the ID from the URL and set it as STUDIES in Vercel env vars' },
                  ].map(({ n, title, detail }) => (
                    <div key={n} className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {n}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-slate-700">{title}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => { setStep(1); setPastedText(''); setGoogleDocsUrl(''); setFiles([]); }}
                className="mt-6 text-sm text-slate-500 hover:text-slate-700 transition"
              >
                Start over with a different study
              </button>
            </div>
          )}

        </main>
      </div>
    </>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'study';
}
