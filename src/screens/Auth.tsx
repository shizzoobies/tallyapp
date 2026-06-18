import { useState, type FormEvent } from 'react'
import { api } from '../api'

export default function Auth({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'register') await api.register(email, password)
      else await api.login(email, password)
      onAuthed()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrap">
      <div className="card">
        <h1>MBS Tally</h1>
        <p className="brandline">Mind Body &amp; Spirit Medicine</p>
        <p className="muted">{mode === 'register' ? 'Create your account' : 'Welcome back'}</p>
        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={busy}>
            {busy ? 'Please wait...' : mode === 'register' ? 'Create account' : 'Log in'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>
          {mode === 'register' ? 'Already have an account? ' : 'New here? '}
          <button
            className="link"
            onClick={() => {
              setMode(mode === 'register' ? 'login' : 'register')
              setError('')
            }}
          >
            {mode === 'register' ? 'Log in' : 'Create account'}
          </button>
        </p>
        <p className="muted center" style={{ marginTop: 12, fontSize: '0.76rem' }}>
          <a className="exlink" href="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy policy
          </a>
        </p>
      </div>
    </div>
  )
}
