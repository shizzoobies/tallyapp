// Thin client for the Pages Functions API. Cookies are same-origin, so the
// HttpOnly session cookie rides along automatically.

import type { Estimate } from './lib/estimate'

export type Me = {
  id: string
  email: string
  sex: 'male' | 'female' | null
  height_cm: number | null
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

export type FoodLog = {
  id: string
  meal: string | null
  name: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  source: string
  restaurant: string | null
  barcode: string | null
  photo_key: string | null
  created_at: string
}

export type ExerciseLog = {
  id: string
  activity_key: string
  duration_min: number
  calories_burned: number
  created_at: string
}

export type Day = {
  date: string
  weight_kg: number | null
  latest_weight_kg: number | null
  foods: FoodLog[]
  exercises: ExerciseLog[]
  target: number | null
  tdee: number | null
  consumed: number
  burned: number
  remaining: number | null
  exercise_credit_pct: number
  setup_complete: boolean
}

export type BarcodeResult = {
  found: boolean
  name?: string
  barcode?: string
  basis?: 'serving' | '100g'
  serving_text?: string | null
  calories?: number | null
  protein_g?: number | null
  carbs_g?: number | null
  fat_g?: number | null
}

export type WeightPoint = { date: string; weight_kg: number; trend_kg: number }
export type HistoryPoint = { date: string; consumed: number; burned: number }

async function jsonOrThrow(r: Response): Promise<unknown> {
  const data: unknown = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = (data as { error?: string }).error ?? `Request failed (${r.status})`
    throw new Error(msg)
  }
  return data
}

const jsonHeaders = { 'content-type': 'application/json' }
const postJson = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }).then(jsonOrThrow)

export const api = {
  async me(): Promise<Me | null> {
    const r = await fetch('/api/me')
    if (r.status === 401) return null
    return (await jsonOrThrow(r)) as Me
  },
  register: (email: string, password: string) => postJson('/api/auth/register', { email, password }),
  login: (email: string, password: string) => postJson('/api/auth/login', { email, password }),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }).then(jsonOrThrow),
  patchMe: (fields: Record<string, unknown>) =>
    fetch('/api/me', { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(fields) }).then(jsonOrThrow),
  deleteAccount: (password: string) =>
    fetch('/api/me', { method: 'DELETE', headers: jsonHeaders, body: JSON.stringify({ password }) }).then(jsonOrThrow),

  postWeight: (date: string, weight_kg: number) => postJson('/api/weight', { date, weight_kg }),

  async getDay(date: string): Promise<Day> {
    return (await jsonOrThrow(await fetch(`/api/day/${date}`))) as Day
  },
  postFood: (payload: Record<string, unknown>) => postJson('/api/food', payload),
  patchFood: (id: string, fields: Record<string, unknown>) =>
    fetch(`/api/food/${id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(fields) }).then(jsonOrThrow),
  deleteFood: (id: string) => fetch(`/api/food/${id}`, { method: 'DELETE' }).then(jsonOrThrow),

  postExercise: (date: string, activity_key: string, duration_min: number) =>
    postJson('/api/exercise', { date, activity_key, duration_min }),
  deleteExercise: (id: string) => fetch(`/api/exercise/${id}`, { method: 'DELETE' }).then(jsonOrThrow),

  async uploadPhoto(blob: Blob): Promise<{ photo_key: string }> {
    const fd = new FormData()
    fd.append('file', blob, 'meal.jpg')
    return (await jsonOrThrow(await fetch('/api/photo/upload', { method: 'POST', body: fd }))) as {
      photo_key: string
    }
  },
  estimate: (payload: { photo_key: string; restaurant?: string; description?: string }) =>
    postJson('/api/estimate', payload) as Promise<Estimate>,

  async lookupBarcode(code: string): Promise<BarcodeResult> {
    const r = await fetch(`/api/barcode/${encodeURIComponent(code)}`)
    if (r.status === 404) return { found: false }
    return (await jsonOrThrow(r)) as BarcodeResult
  },

  async getWeights(from?: string, to?: string): Promise<WeightPoint[]> {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    const qs = q.toString()
    return (await jsonOrThrow(await fetch(`/api/weights${qs ? `?${qs}` : ''}`))) as WeightPoint[]
  },
  async getHistory(from: string, to: string): Promise<HistoryPoint[]> {
    return (await jsonOrThrow(await fetch(`/api/history?from=${from}&to=${to}`))) as HistoryPoint[]
  },
}

// Local calendar date as YYYY-MM-DD. The client owns "today" so an evening log
// does not slip into the next UTC day (no user timezone is stored server-side).
export function todayISO(): string {
  return formatDate(new Date())
}

export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Shift an ISO date by whole days, staying on calendar dates (noon avoids DST edges).
export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return formatDate(d)
}
