// Thin client for the Pages Functions API. Cookies are same-origin, so the
// HttpOnly session cookie rides along automatically.

export type Me = {
  id: string
  email: string
  sex: 'male' | 'female' | null
  height_cm: number | null
  birthdate: string | null
  activity: string
  goal_weight_kg: number | null
  goal_rate_kg_per_week: number | null
  exercise_credit_pct: number
  units: 'metric' | 'imperial'
  latest_weight_kg: number | null
  age: number | null
  setup_complete: boolean
  tdee: number | null
  daily_target: number | null
}

async function jsonOrThrow(r: Response): Promise<unknown> {
  const data: unknown = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = (data as { error?: string }).error ?? `Request failed (${r.status})`
    throw new Error(msg)
  }
  return data
}

const jsonHeaders = { 'content-type': 'application/json' }

export const api = {
  async me(): Promise<Me | null> {
    const r = await fetch('/api/me')
    if (r.status === 401) return null
    return (await jsonOrThrow(r)) as Me
  },
  register(email: string, password: string) {
    return fetch('/api/auth/register', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ email, password }),
    }).then(jsonOrThrow)
  },
  login(email: string, password: string) {
    return fetch('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ email, password }),
    }).then(jsonOrThrow)
  },
  logout() {
    return fetch('/api/auth/logout', { method: 'POST' }).then(jsonOrThrow)
  },
  patchMe(fields: Record<string, unknown>) {
    return fetch('/api/me', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(fields),
    }).then(jsonOrThrow)
  },
  postWeight(date: string, weight_kg: number) {
    return fetch('/api/weight', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ date, weight_kg }),
    }).then(jsonOrThrow)
  },
}

// Local calendar date as YYYY-MM-DD. The client owns "today" so an evening log
// does not slip into the next UTC day (no user timezone is stored server-side).
export function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
