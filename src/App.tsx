import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { api, type Me } from './api'
import Auth from './screens/Auth'
import Setup from './screens/Setup'
import Today from './screens/Today'

// Trends pulls in Recharts, so load it only when opened.
const Trends = lazy(() => import('./screens/Trends'))

type View = 'loading' | 'auth' | 'setup' | 'home' | 'trends'

export default function App() {
  const [view, setView] = useState<View>('loading')
  const [me, setMe] = useState<Me | null>(null)

  // Single source of truth: ask the server who we are, then route.
  const load = useCallback(async () => {
    const m = await api.me().catch(() => null)
    if (!m) {
      setMe(null)
      setView('auth')
      return
    }
    setMe(m)
    setView(m.setup_complete ? 'home' : 'setup')
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (view === 'loading') {
    return (
      <div className="wrap">
        <div className="card">
          <p className="muted">Loading...</p>
        </div>
      </div>
    )
  }
  if (view === 'auth') return <Auth onAuthed={load} />
  if (view === 'setup' && me) return <Setup me={me} onDone={load} />
  if (view === 'trends' && me) {
    return (
      <Suspense
        fallback={
          <div className="wrap">
            <div className="card">
              <p className="muted">Loading charts...</p>
            </div>
          </div>
        }
      >
        <Trends me={me} onBack={() => setView('home')} />
      </Suspense>
    )
  }
  if (view === 'home' && me) {
    return (
      <Today
        me={me}
        onEdit={() => setView('setup')}
        onLogout={load}
        onMeChanged={load}
        onTrends={() => setView('trends')}
      />
    )
  }
  return null
}
