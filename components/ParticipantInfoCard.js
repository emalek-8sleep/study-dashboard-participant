/**
 * ParticipantInfoCard
 *
 * Displays custom participant information (autopilot codes, login credentials, etc.)
 * from the Participants sheet with a toggle to show/hide sensitive info.
 *
 * Reads any columns starting with "Info_" and displays them as labeled fields.
 * The "Info_" prefix is stripped for display (e.g., Info_Autopilot_Code → Autopilot Code).
 */

import { useState } from 'react';

export default function ParticipantInfoCard({ participantData = {} }) {
  const [isOpen, setIsOpen] = useState(false);

  // Extract all "Info_" prefixed columns
  const infoFields = Object.entries(participantData)
    .filter(([key]) => key.startsWith('Info_'))
    .map(([key, value]) => ({
      key,
      label: key
        .replace(/^Info_/, '')  // Remove "Info_" prefix
        .replace(/_/g, ' ')      // Replace underscores with spaces
        .replace(/\b\w/g, c => c.toUpperCase()), // Title case
      value: (value || '').toString().trim(),
    }))
    .filter(field => field.value.length > 0); // Only show non-empty fields

  // Don't render if no info fields
  if (infoFields.length === 0) {
    return null;
  }

  return (
    <div className="card border-slate-100">
      {/* Header with toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-4 hover:bg-slate-50 transition rounded-lg p-1 -m-1"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="text-left">
            <h3 className="section-title mb-0">Important Information</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {infoFields.length} {infoFields.length === 1 ? 'item' : 'items'} {isOpen ? 'shown' : 'hidden'}
            </p>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expandable content */}
      {isOpen && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
          {infoFields.map((field, i) => (
            <div key={i} className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                {field.label}
              </label>
              <div className="bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
                <code className="text-sm font-mono text-slate-800 break-all">
                  {field.value}
                </code>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info box when collapsed */}
      {!isOpen && (
        <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
          <p className="text-xs text-blue-700">
            Click to reveal {infoFields.length} {infoFields.length === 1 ? 'item' : 'items'} (login details, codes, etc.)
          </p>
        </div>
      )}
    </div>
  );
}
