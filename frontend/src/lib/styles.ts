/**
 * Shared style constants for the Rootstock UI.
 *
 * Import these instead of redefining identical objects in every page.
 * Design tokens:
 *   Background  #0f0f1a
 *   Card        #1a1a2e
 *   Border      #2a2a3e
 *   Text        #e0e0e0
 *   Muted       #8890a0
 *   Primary     #7c9ef8
 */

import type React from 'react'

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export const inputStyle: React.CSSProperties = {
  background: '#0f0f1a',
  border: '1px solid #2a2a3e',
  borderRadius: '4px',
  color: '#e0e0e0',
  padding: '0.4rem 0.6rem',
  fontSize: '0.9rem',
  width: '100%',
  boxSizing: 'border-box',
}

export const selectStyle: React.CSSProperties = {
  ...inputStyle,
}

export const labelStyle: React.CSSProperties = {
  display: 'block',
  color: '#8890a0',
  fontSize: '0.8rem',
  marginBottom: '0.25rem',
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export const primaryBtn: React.CSSProperties = {
  background: '#7c9ef8',
  color: '#0f0f1a',
  border: 'none',
  borderRadius: '4px',
  padding: '0.4rem 1rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
  fontWeight: 600,
}

export const secondaryBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#7c9ef8',
  border: '1px solid #7c9ef8',
  borderRadius: '4px',
  padding: '0.4rem 1rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
}

export const dangerBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#f87171',
  border: '1px solid #f87171',
  borderRadius: '4px',
  padding: '0.4rem 1rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
}

export const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2a2a3e',
  borderRadius: '4px',
  color: '#8890a0',
  cursor: 'pointer',
  padding: '0.4rem 0.75rem',
  fontSize: '0.85rem',
}

// ---------------------------------------------------------------------------
// Layout containers
// ---------------------------------------------------------------------------

export const cardStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: '6px',
  padding: '1.25rem',
  border: '1px solid #2a2a3e',
}

export const sectionStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: '6px',
  padding: '1rem',
  marginBottom: '1rem',
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

export const thStyle: React.CSSProperties = {
  textAlign: 'left',
  color: '#8890a0',
  padding: '0.4rem 0.75rem',
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  borderBottom: '1px solid #2a2a3e',
}

export const tdStyle: React.CSSProperties = {
  color: '#e0e0e0',
  padding: '0.5rem 0.75rem',
  fontSize: '0.9rem',
  borderBottom: '1px solid #1a1a2e',
}

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

export const statusBadge = (status: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; text: string }> = {
    running:  { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
    healthy:  { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
    stopped:  { bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
    exited:   { bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
    error:    { bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
    paused:   { bg: 'rgba(251,191,36,0.15)',  text: '#fbbf24' },
    created:  { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8' },
    unknown:  { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8' },
  }
  const c = colors[status.toLowerCase()] ?? { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8' }
  return {
    display: 'inline-block',
    padding: '0.1rem 0.5rem',
    borderRadius: '9999px',
    fontSize: '0.72rem',
    fontWeight: 600,
    background: c.bg,
    color: c.text,
    whiteSpace: 'nowrap',
  }
}

// ---------------------------------------------------------------------------
// Modal overlay
// ---------------------------------------------------------------------------

export const modalOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
}

export const modalBox: React.CSSProperties = {
  background: '#1a1a2e',
  border: '1px solid #2a2a3e',
  borderRadius: '8px',
  padding: '1.5rem',
  minWidth: '320px',
  maxWidth: '520px',
  width: '90vw',
}
