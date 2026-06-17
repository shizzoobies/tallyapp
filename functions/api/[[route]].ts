import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context, MiddlewareHandler } from 'hono'
import { ACTIVITY, ageOn, bmr, dailyTarget, tdee, type ActivityKey } from '../../src/lib/calc'

type Bindings = {
  DB: D1Database
  BUCKET: R2Bucket
  ANTHROPIC_API_KEY: string
}
type Variables = { userId: string }
type Env = { Bindings: Bindings; Variables: Variables }
type AppContext = Context<Env>

const SESSION_COOKIE = 'tally_session'
const SESSION_DAYS = 30
const PBKDF2_ITERATIONS = 100_000

const app = new Hono<Env>().basePath('/api')

// ---------- crypto + helpers ----------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const km = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    km,
    256,
  )
  return bytesToBase64(new Uint8Array(bits))
}

// Constant-time string compare to avoid leaking the hash via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function isHttps(c: AppContext): boolean {
  return new URL(c.req.url).protocol === 'https:'
}

async function createSession(c: AppContext, userId: string): Promise<void> {
  const token = randomToken()
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString()
  await c.env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expires)
    .run()
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps(c),
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  })
}

const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return c.json({ error: 'unauthenticated' }, 401)
  const s = await c.env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
    .bind(token)
    .first<{ user_id: string; expires_at: string }>()
  if (!s) return c.json({ error: 'unauthenticated' }, 401)
  if (new Date(s.expires_at).getTime() < Date.now()) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
    return c.json({ error: 'session expired' }, 401)
  }
  c.set('userId', s.user_id)
  await next()
}

// ---------- auth ----------

app.post('/auth/register', async (c) => {
  const body = await c.req.json().catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()
  const password = body?.password
  if (!isEmail(email) || typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return c.json({ error: 'Enter a valid email and a password of 8 to 200 characters.' }, 400)
  }
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) return c.json({ error: 'That email is already registered.' }, 409)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt)
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO users (id, email, pw_hash, pw_salt) VALUES (?, ?, ?, ?)')
    .bind(id, email, hash, bytesToBase64(salt))
    .run()
  await createSession(c, id)
  return c.json({ id, email }, 201)
})

app.post('/auth/login', async (c) => {
  const body = await c.req.json().catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()
  const password = typeof body?.password === 'string' ? body.password : ''
  const u = await c.env.DB.prepare('SELECT id, pw_hash, pw_salt FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; pw_hash: string; pw_salt: string }>()
  // Always run the KDF, even when the email is unknown, so login timing does not
  // reveal whether an email is registered.
  const salt = u ? base64ToBytes(u.pw_salt) : new Uint8Array(16)
  const hash = await pbkdf2(password, salt)
  if (!u || !timingSafeEqual(hash, u.pw_hash)) return c.json({ error: 'Invalid email or password.' }, 401)
  await createSession(c, u.id)
  return c.json({ id: u.id, email })
})

app.post('/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

// ---------- profile + computed target ----------

type UserRow = {
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
  created_at: string
}

app.get('/me', requireAuth, async (c) => {
  const uid = c.get('userId')
  const u = await c.env.DB.prepare(
    `SELECT id, email, sex, height_cm, birthdate, activity, goal_weight_kg,
            goal_rate_kg_per_week, exercise_credit_pct, units, created_at
     FROM users WHERE id = ?`,
  )
    .bind(uid)
    .first<UserRow>()
  if (!u) return c.json({ error: 'unauthenticated' }, 401)

  const w = await c.env.DB.prepare(
    'SELECT weight_kg FROM weight_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 1',
  )
    .bind(uid)
    .first<{ weight_kg: number }>()
  const latestWeightKg = w?.weight_kg ?? null

  const profileComplete =
    !!u.sex &&
    u.height_cm != null &&
    !!u.birthdate &&
    u.activity in ACTIVITY &&
    u.goal_rate_kg_per_week != null
  const setupComplete = profileComplete && latestWeightKg != null

  let age: number | null = null
  let tdeeVal: number | null = null
  let target: number | null = null
  if (setupComplete) {
    age = ageOn(u.birthdate as string, new Date())
    const tdeeExact = tdee(
      bmr(u.sex as 'male' | 'female', latestWeightKg as number, u.height_cm as number, age),
      u.activity as ActivityKey,
    )
    tdeeVal = Math.round(tdeeExact)
    target = dailyTarget(tdeeExact, u.goal_rate_kg_per_week as number, u.sex as 'male' | 'female')
  }

  return c.json({
    ...u,
    latest_weight_kg: latestWeightKg,
    age,
    setup_complete: setupComplete,
    tdee: tdeeVal,
    daily_target: target,
  })
})

app.patch('/me', requireAuth, async (c) => {
  const uid = c.get('userId')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const sets: string[] = []
  const vals: unknown[] = []

  if (body.sex !== undefined) {
    if (body.sex !== 'male' && body.sex !== 'female') return c.json({ error: 'sex must be male or female' }, 400)
    sets.push('sex = ?'), vals.push(body.sex)
  }
  if (body.height_cm !== undefined) {
    const h = Number(body.height_cm)
    if (!(h > 0 && h < 300)) return c.json({ error: 'height_cm out of range' }, 400)
    sets.push('height_cm = ?'), vals.push(h)
  }
  if (body.birthdate !== undefined) {
    if (typeof body.birthdate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.birthdate))
      return c.json({ error: 'birthdate must be YYYY-MM-DD' }, 400)
    sets.push('birthdate = ?'), vals.push(body.birthdate)
  }
  if (body.activity !== undefined) {
    if (typeof body.activity !== 'string' || !(body.activity in ACTIVITY))
      return c.json({ error: 'invalid activity level' }, 400)
    sets.push('activity = ?'), vals.push(body.activity)
  }
  if (body.goal_weight_kg !== undefined && body.goal_weight_kg !== null) {
    const v = Number(body.goal_weight_kg)
    if (!(v > 0 && v < 700)) return c.json({ error: 'goal_weight_kg out of range' }, 400)
    sets.push('goal_weight_kg = ?'), vals.push(v)
  }
  if (body.goal_rate_kg_per_week !== undefined) {
    const v = Number(body.goal_rate_kg_per_week)
    if (!(v >= -2 && v <= 2)) return c.json({ error: 'goal_rate_kg_per_week out of range' }, 400)
    sets.push('goal_rate_kg_per_week = ?'), vals.push(v)
  }
  if (body.exercise_credit_pct !== undefined) {
    const v = Math.round(Number(body.exercise_credit_pct))
    if (!(v >= 0 && v <= 100)) return c.json({ error: 'exercise_credit_pct must be 0 to 100' }, 400)
    sets.push('exercise_credit_pct = ?'), vals.push(v)
  }
  if (body.units !== undefined) {
    if (body.units !== 'metric' && body.units !== 'imperial')
      return c.json({ error: 'units must be metric or imperial' }, 400)
    sets.push('units = ?'), vals.push(body.units)
  }

  if (sets.length === 0) return c.json({ error: 'no valid fields to update' }, 400)
  vals.push(uid)
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
  return c.json({ ok: true })
})

// ---------- weight (minimal: setup seeds the weight that BMR needs) ----------

app.post('/weight', requireAuth, async (c) => {
  const uid = c.get('userId')
  const body = await c.req.json().catch(() => null)
  const date = body?.date
  const kg = Number(body?.weight_kg)
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  if (!(kg > 0 && kg < 700)) return c.json({ error: 'weight_kg out of range' }, 400)
  await c.env.DB.prepare(
    `INSERT INTO weight_logs (id, user_id, log_date, weight_kg) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, log_date) DO UPDATE SET weight_kg = excluded.weight_kg`,
  )
    .bind(crypto.randomUUID(), uid, date, kg)
    .run()
  return c.json({ ok: true })
})

export const onRequest = handle(app)
