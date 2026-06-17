import { useEffect, useState } from 'react'

// Phase 0 placeholder screen. It pings /api/me to confirm the Functions API is wired up.
export default function App() {
  const [status, setStatus] = useState('checking the API...')

  useEffect(() => {
    fetch('/api/me')
      .then((r) => setStatus(`/api/me responded ${r.status}`))
      .catch(() => setStatus('/api/me is unreachable'))
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 480 }}>
      <h1>Tally</h1>
      <p>Phase 0 scaffold is live.</p>
      <p style={{ color: '#666' }}>{status}</p>
    </main>
  )
}
