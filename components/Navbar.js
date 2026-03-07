import { useState } from 'react';
import Link from 'next/link';

/**
 * Navbar
 *
 * Props:
 *   studyName   — display name of the study
 *   subjectId   — current participant's subject ID (used to build resource links)
 *   contactEmail — optional email for the help link
 *   page        — 'dashboard' | 'resources'  (controls which tab is active)
 */
export default function Navbar({ studyName, subjectId, contactEmail, page = 'dashboard' }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const dashboardHref  = `/dashboard/${encodeURIComponent(subjectId)}`;
  const resourcesHref  = `/resources/${encodeURIComponent(subjectId)}`;

  return (
    <nav className="bg-white border-b border-slate-100 sticky top-0 z-50 shadow-sm">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-center h-16 gap-4">

          {/* Logo */}
          <div className="flex items-center gap-2 flex-1">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <span className="font-semibold text-slate-800 text-sm hidden sm:block truncate max-w-[180px]">
              {studyName}
            </span>
          </div>

          {/* Desktop nav — page tabs */}
          <div className="hidden sm:flex items-center gap-1 text-sm">
            <PageLink href={dashboardHref} active={page === 'dashboard'}>
              Dashboard
            </PageLink>
            <PageLink href={resourcesHref} active={page === 'resources'}>
              Resources
            </PageLink>

            {/* In-page anchors for the current page */}
            {page === 'dashboard' && (
              <>
                <Divider />
                <AnchorLink href="#daily-status">Check-in</AnchorLink>
                <AnchorLink href="#progress">Progress</AnchorLink>
                <AnchorLink href="#comments">Q&amp;A</AnchorLink>
              </>
            )}
            {page === 'resources' && (
              <>
                <Divider />
                <AnchorLink href="#docs">Documents</AnchorLink>
                <AnchorLink href="#troubleshoot">Troubleshooting</AnchorLink>
              </>
            )}
          </div>

          {/* Subject ID badge */}
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 shrink-0">
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="font-mono font-medium text-slate-700">{subjectId}</span>
          </div>

          {/* Exit */}
          <Link href="/"
            className="text-xs text-slate-400 hover:text-slate-600 transition font-medium hidden sm:block shrink-0">
            Exit
          </Link>

          {/* Mobile hamburger */}
          <button
            className="sm:hidden p-2 rounded-lg hover:bg-slate-100 transition"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              }
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="sm:hidden border-t border-slate-100 py-3 space-y-0.5">
            <MobileNavLink href={dashboardHref} onClick={() => setMenuOpen(false)} active={page === 'dashboard'}>
              Dashboard
            </MobileNavLink>
            <MobileNavLink href={resourcesHref} onClick={() => setMenuOpen(false)} active={page === 'resources'}>
              Resources
            </MobileNavLink>

            {page === 'dashboard' && (
              <>
                <div className="h-px bg-slate-100 my-2 mx-3" />
                <MobileAnchorLink href="#daily-status" onClick={() => setMenuOpen(false)}>Check-in</MobileAnchorLink>
                <MobileAnchorLink href="#progress" onClick={() => setMenuOpen(false)}>Progress</MobileAnchorLink>
                <MobileAnchorLink href="#comments" onClick={() => setMenuOpen(false)}>Q&amp;A</MobileAnchorLink>
              </>
            )}
            {page === 'resources' && (
              <>
                <div className="h-px bg-slate-100 my-2 mx-3" />
                <MobileAnchorLink href="#docs" onClick={() => setMenuOpen(false)}>Documents</MobileAnchorLink>
                <MobileAnchorLink href="#troubleshoot" onClick={() => setMenuOpen(false)}>Troubleshooting</MobileAnchorLink>
              </>
            )}

            <div className="pt-2 border-t border-slate-100 mt-2">
              <Link href="/" className="block px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 rounded-lg">
                Exit Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

function Divider() {
  return <span className="w-px h-4 bg-slate-200 mx-1" />;
}

function PageLink({ href, active, children }) {
  return (
    <Link href={href}
      className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
        active
          ? 'bg-brand-50 text-brand-700'
          : 'text-slate-500 hover:text-brand-600 hover:bg-brand-50'
      }`}>
      {children}
    </Link>
  );
}

function AnchorLink({ href, children }) {
  return (
    <a href={href}
      className="px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition text-xs font-medium">
      {children}
    </a>
  );
}

function MobileNavLink({ href, onClick, active, children }) {
  return (
    <Link href={href} onClick={onClick}
      className={`block px-3 py-2 rounded-lg text-sm font-semibold transition ${
        active ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'
      }`}>
      {children}
    </Link>
  );
}

function MobileAnchorLink({ href, onClick, children }) {
  return (
    <a href={href} onClick={onClick}
      className="block px-5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-50 text-sm">
      {children}
    </a>
  );
}
