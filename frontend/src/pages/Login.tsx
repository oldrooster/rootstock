import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setAuth, isAuthenticated } from '../lib/api'
import logo from '../assets/logo.png'

type Mode = 'loading' | 'setup' | 'login'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.75rem',
  background: '#0f0f1a',
  border: '1px solid #2a2a3e',
  borderRadius: '6px',
  color: '#e0e0e0',
  fontSize: '0.95rem',
  boxSizing: 'border-box',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.35rem',
  color: '#8890a0',
  fontSize: '0.85rem',
}

const fieldStyle: React.CSSProperties = {
  marginBottom: '1rem',
}

const primaryBtn: React.CSSProperties = {
  width: '100%',
  padding: '0.65rem',
  background: '#7c9ef8',
  color: '#0f0f1a',
  border: 'none',
  borderRadius: '6px',
  fontSize: '0.95rem',
  fontWeight: 600,
  cursor: 'pointer',
  marginTop: '0.5rem',
}

const disabledBtn: React.CSSProperties = {
  ...primaryBtn,
  opacity: 0.6,
  cursor: 'not-allowed',
}

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('loading')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    // If already authenticated, go straight to dashboard
    if (isAuthenticated()) {
      navigate('/dashboard', { replace: true })
      return
    }
    // Check whether first-run setup is required
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(data => setMode(data.setup_required ? 'setup' : 'login'))
      .catch(() => setMode('login'))
  }, [navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (mode === 'setup') {
      if (!username.trim()) { setError('Username is required'); return }
      if (password.length < 8) { setError('Password must be at least 8 characters'); return }
      if (password !== confirmPassword) { setError('Passwords do not match'); return }
    }

    setSubmitting(true)
    try {
      const endpoint = mode === 'setup' ? '/api/auth/setup' : '/api/auth/login'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || 'An error occurred')
        return
      }
      setAuth(data.token, data.username)
      navigate('/dashboard', { replace: true })
    } catch {
      setError('Could not connect to server')
    } finally {
      setSubmitting(false)
    }
  }

  if (mode === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#8890a0' }}>Loading...</span>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f0f1a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        background: '#1a1a2e',
        border: '1px solid #2a2a3e',
        borderRadius: '10px',
        padding: '2rem',
        width: '100%',
        maxWidth: '380px',
      }}>
        {/* Logo + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.75rem', justifyContent: 'center' }}>
          <img src={logo} alt="Rootstock" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
          <h1 style={{ fontSize: '1.3rem', margin: 0 }}>
            <span style={{ color: '#e0e0e0' }}>Root</span>
            <span style={{ color: '#7CC5D4' }}>stock</span>
          </h1>
        </div>

        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#e0e0e0', margin: '0 0 0.25rem 0', textAlign: 'center' }}>
          {mode === 'setup' ? 'Create your account' : 'Sign in'}
        </h2>
        {mode === 'setup' && (
          <p style={{ color: '#8890a0', fontSize: '0.82rem', textAlign: 'center', margin: '0 0 1.5rem 0' }}>
            First run — set a username and password to secure access.
          </p>
        )}
        {mode === 'login' && (
          <p style={{ color: '#8890a0', fontSize: '0.82rem', textAlign: 'center', margin: '0 0 1.5rem 0' }}>
            Enter your credentials to continue.
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              style={inputStyle}
              autoComplete="username"
              autoFocus
              disabled={submitting}
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={inputStyle}
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              disabled={submitting}
            />
          </div>

          {mode === 'setup' && (
            <div style={fieldStyle}>
              <label style={labelStyle}>Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                style={inputStyle}
                autoComplete="new-password"
                disabled={submitting}
              />
            </div>
          )}

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '6px',
              padding: '0.6rem 0.75rem',
              color: '#f87171',
              fontSize: '0.85rem',
              marginBottom: '0.75rem',
            }}>
              {error}
            </div>
          )}

          <button type="submit" style={submitting ? disabledBtn : primaryBtn} disabled={submitting}>
            {submitting ? 'Please wait...' : mode === 'setup' ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
