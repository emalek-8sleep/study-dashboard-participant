import Head from 'next/head';
import { getParticipant, getStudyConfig, getDocs, getTroubleshooting } from '../../lib/sheets';
import { getSheetIdBySlug } from '../../lib/studies';
import DocsSection          from '../../components/DocsSection';
import TroubleshootingSection from '../../components/TroubleshootingSection';
import Navbar               from '../../components/Navbar';

export async function getServerSideProps({ params, req }) {
  const { subjectId } = params;

  // Determine which study's sheet to use based on the active_study cookie
  const cookies   = parseCookies(req.headers.cookie || '');
  const studySlug = decodeURIComponent(cookies['active_study'] || '');
  const sheetId   = getSheetIdBySlug(studySlug);

  const [participant, config, docs, troubleshooting] = await Promise.all([
    getParticipant(subjectId, sheetId),
    getStudyConfig(sheetId),
    getDocs(sheetId),
    getTroubleshooting(sheetId),
  ]);

  if (!participant) {
    return { redirect: { destination: '/?error=not_found', permanent: false } };
  }

  return {
    props: { config, docs, troubleshooting, subjectId },
  };
}

export default function ResourcesPage({ config, docs, troubleshooting, subjectId }) {
  const studyName    = config.study_name    || 'Study Participant Dashboard';
  const contactEmail = config.contact_email || '';

  return (
    <>
      <Head>
        <title>{`Resources — ${subjectId} | ${studyName}`}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="min-h-screen bg-slate-50">
        <Navbar
          studyName={studyName}
          subjectId={subjectId}
          contactEmail={contactEmail}
          page="resources"
        />

        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">

          {/* Page header */}
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Study Resources</h1>
            <p className="text-slate-500 text-sm mt-1">
              Study documents, instructions, and device troubleshooting guides.
            </p>
          </div>

          {/* Study documents */}
          {docs.length > 0 && (
            <section id="docs">
              <h2 className="section-title">Study Documents &amp; Instructions</h2>
              <p className="section-subtitle">Everything you need — protocols, guides, and reference materials.</p>
              <DocsSection docs={docs} />
            </section>
          )}

          {docs.length === 0 && (
            <div className="card text-center text-slate-400 py-10">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">No documents have been added yet.</p>
            </div>
          )}

          {/* Troubleshooting */}
          {troubleshooting.length > 0 && (
            <section id="troubleshoot">
              <h2 className="section-title">Device Troubleshooting</h2>
              <p className="section-subtitle">Step-by-step help for common device issues.</p>
              <TroubleshootingSection items={troubleshooting} />
            </section>
          )}

          {troubleshooting.length === 0 && (
            <div className="card text-center text-slate-400 py-10">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              </svg>
              <p className="text-sm">No troubleshooting guides have been added yet.</p>
            </div>
          )}

          {/* Footer */}
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

function parseCookies(cookieHeader) {
  const result = {};
  cookieHeader.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) result[key.trim()] = rest.join('=').trim();
  });
  return result;
}
