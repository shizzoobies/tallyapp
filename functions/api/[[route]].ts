import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context, MiddlewareHandler } from 'hono'
import {
  ACTIVITY,
  ageOn,
  bmr,
  dailyTarget,
  exerciseKcal,
  remaining,
  tdee,
  type ActivityKey,
} from '../../src/lib/calc'
import { MET_BY_KEY } from '../../src/lib/mets'
import { parseEstimateText } from '../../src/lib/estimate'

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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

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

function nonNegNum(x: unknown): number {
  const n = Number(x)
  return Number.isFinite(n) && n >= 0 ? n : 0
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

// ---------- shared profile + target ----------

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

function loadUser(c: AppContext, uid: string): Promise<UserRow | null> {
  return c.env.DB.prepare(
    `SELECT id, email, sex, height_cm, birthdate, activity, goal_weight_kg,
            goal_rate_kg_per_week, exercise_credit_pct, units, created_at
     FROM users WHERE id = ?`,
  )
    .bind(uid)
    .first<UserRow>()
}

async function latestWeightKg(c: AppContext, uid: string): Promise<number | null> {
  const w = await c.env.DB.prepare(
    'SELECT weight_kg FROM weight_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 1',
  )
    .bind(uid)
    .first<{ weight_kg: number }>()
  return w?.weight_kg ?? null
}

// Single definition of "the target" so /api/me and /api/day never disagree.
function computeTarget(u: UserRow, weightKg: number | null) {
  const profileComplete =
    !!u.sex &&
    u.height_cm != null &&
    !!u.birthdate &&
    u.activity in ACTIVITY &&
    u.goal_rate_kg_per_week != null
  const setupComplete = profileComplete && weightKg != null
  let age: number | null = null
  let tdeeVal: number | null = null
  let target: number | null = null
  if (setupComplete) {
    age = ageOn(u.birthdate as string, new Date())
    const tdeeExact = tdee(
      bmr(u.sex as 'male' | 'female', weightKg as number, u.height_cm as number, age),
      u.activity as ActivityKey,
    )
    tdeeVal = Math.round(tdeeExact)
    target = dailyTarget(tdeeExact, u.goal_rate_kg_per_week as number, u.sex as 'male' | 'female')
  }
  return { age, tdee: tdeeVal, target, setupComplete }
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

// ---------- profile ----------

app.get('/me', requireAuth, async (c) => {
  const uid = c.get('userId')
  const u = await loadUser(c, uid)
  if (!u) return c.json({ error: 'unauthenticated' }, 401)
  const lw = await latestWeightKg(c, uid)
  const comp = computeTarget(u, lw)
  return c.json({
    ...u,
    latest_weight_kg: lw,
    age: comp.age,
    setup_complete: comp.setupComplete,
    tdee: comp.tdee,
    daily_target: comp.target,
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
    if (typeof body.birthdate !== 'string' || !DATE_RE.test(body.birthdate))
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

// ---------- weight ----------

app.post('/weight', requireAuth, async (c) => {
  const uid = c.get('userId')
  const body = await c.req.json().catch(() => null)
  const date = body?.date
  const kg = Number(body?.weight_kg)
  if (typeof date !== 'string' || !DATE_RE.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  if (!(kg > 0 && kg < 700)) return c.json({ error: 'weight_kg out of range' }, 400)
  await c.env.DB.prepare(
    `INSERT INTO weight_logs (id, user_id, log_date, weight_kg) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, log_date) DO UPDATE SET weight_kg = excluded.weight_kg`,
  )
    .bind(crypto.randomUUID(), uid, date, kg)
    .run()
  return c.json({ ok: true })
})

// ---------- day aggregate ----------

type FoodRow = {
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
type ExRow = {
  id: string
  activity_key: string
  duration_min: number
  calories_burned: number
  created_at: string
}

app.get('/day/:date', requireAuth, async (c) => {
  const uid = c.get('userId')
  const date = c.req.param('date')
  if (!DATE_RE.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  const u = await loadUser(c, uid)
  if (!u) return c.json({ error: 'unauthenticated' }, 401)

  const lw = await latestWeightKg(c, uid)
  const comp = computeTarget(u, lw)

  const dayW = await c.env.DB.prepare(
    'SELECT weight_kg FROM weight_logs WHERE user_id = ? AND log_date = ?',
  )
    .bind(uid, date)
    .first<{ weight_kg: number }>()

  const foods = (
    await c.env.DB.prepare(
      `SELECT id, meal, name, calories, protein_g, carbs_g, fat_g, source, restaurant, barcode, photo_key, created_at
       FROM food_logs WHERE user_id = ? AND log_date = ? ORDER BY created_at`,
    )
      .bind(uid, date)
      .all<FoodRow>()
  ).results
  const exercises = (
    await c.env.DB.prepare(
      `SELECT id, activity_key, duration_min, calories_burned, created_at
       FROM exercise_logs WHERE user_id = ? AND log_date = ? ORDER BY created_at`,
    )
      .bind(uid, date)
      .all<ExRow>()
  ).results

  const consumed = Math.round(foods.reduce((s, f) => s + f.calories, 0))
  const burned = exercises.reduce((s, e) => s + e.calories_burned, 0)
  const rem =
    comp.target != null ? remaining(comp.target, consumed, burned, u.exercise_credit_pct) : null

  return c.json({
    date,
    weight_kg: dayW?.weight_kg ?? null,
    latest_weight_kg: lw,
    foods,
    exercises,
    target: comp.target,
    tdee: comp.tdee,
    consumed,
    burned,
    remaining: rem,
    exercise_credit_pct: u.exercise_credit_pct,
    setup_complete: comp.setupComplete,
  })
})

// ---------- food ----------

app.post('/food', requireAuth, async (c) => {
  const uid = c.get('userId')
  const b = await c.req.json().catch(() => null)
  const date = b?.date
  const name = String(b?.name ?? '').trim()
  const calories = Number(b?.calories)
  if (typeof date !== 'string' || !DATE_RE.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  if (!name) return c.json({ error: 'name is required' }, 400)
  // Never store a null or negative calorie value.
  if (!Number.isFinite(calories) || calories < 0) return c.json({ error: 'calories must be a number >= 0' }, 400)

  const meal = MEALS.includes(b?.meal) ? b.meal : 'snack'
  const source = ['manual', 'ai', 'db'].includes(b?.source) ? b.source : 'manual'
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO food_logs
       (id, user_id, log_date, meal, name, calories, protein_g, carbs_g, fat_g, source, restaurant, barcode, photo_key, ai_raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      uid,
      date,
      meal,
      name,
      Math.round(calories),
      nonNegNum(b?.protein_g),
      nonNegNum(b?.carbs_g),
      nonNegNum(b?.fat_g),
      source,
      b?.restaurant ?? null,
      b?.barcode ?? null,
      b?.photo_key ?? null,
      b?.ai_raw_json ?? null,
    )
    .run()
  return c.json({ ok: true, id }, 201)
})

app.patch('/food/:id', requireAuth, async (c) => {
  const uid = c.get('userId')
  const id = c.req.param('id')
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const sets: string[] = []
  const vals: unknown[] = []
  if (b.name !== undefined) {
    const n = String(b.name).trim()
    if (!n) return c.json({ error: 'name is required' }, 400)
    sets.push('name = ?'), vals.push(n)
  }
  if (b.calories !== undefined) {
    const cc = Number(b.calories)
    if (!Number.isFinite(cc) || cc < 0) return c.json({ error: 'calories must be a number >= 0' }, 400)
    sets.push('calories = ?'), vals.push(Math.round(cc))
  }
  if (b.meal !== undefined) {
    if (typeof b.meal !== 'string' || !MEALS.includes(b.meal)) return c.json({ error: 'invalid meal' }, 400)
    sets.push('meal = ?'), vals.push(b.meal)
  }
  if (b.protein_g !== undefined) sets.push('protein_g = ?'), vals.push(nonNegNum(b.protein_g))
  if (b.carbs_g !== undefined) sets.push('carbs_g = ?'), vals.push(nonNegNum(b.carbs_g))
  if (b.fat_g !== undefined) sets.push('fat_g = ?'), vals.push(nonNegNum(b.fat_g))
  if (sets.length === 0) return c.json({ error: 'no valid fields to update' }, 400)
  vals.push(id, uid)
  const r = await c.env.DB.prepare(`UPDATE food_logs SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...vals)
    .run()
  if ((r.meta.changes ?? 0) === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

app.delete('/food/:id', requireAuth, async (c) => {
  const uid = c.get('userId')
  const id = c.req.param('id')
  const r = await c.env.DB.prepare('DELETE FROM food_logs WHERE id = ? AND user_id = ?')
    .bind(id, uid)
    .run()
  if ((r.meta.changes ?? 0) === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

// ---------- exercise (burn computed server-side from latest weight) ----------

app.post('/exercise', requireAuth, async (c) => {
  const uid = c.get('userId')
  const b = await c.req.json().catch(() => null)
  const date = b?.date
  const key = b?.activity_key
  const dur = Number(b?.duration_min)
  if (typeof date !== 'string' || !DATE_RE.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  if (typeof key !== 'string' || !(key in MET_BY_KEY)) return c.json({ error: 'unknown activity' }, 400)
  if (!Number.isFinite(dur) || dur <= 0 || dur > 1440) return c.json({ error: 'duration must be 1 to 1440 minutes' }, 400)
  const lw = await latestWeightKg(c, uid)
  if (lw == null) return c.json({ error: 'log your weight first' }, 400)

  const kcal = exerciseKcal(MET_BY_KEY[key], lw, Math.round(dur))
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    'INSERT INTO exercise_logs (id, user_id, log_date, activity_key, duration_min, calories_burned) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, uid, date, key, Math.round(dur), kcal)
    .run()
  return c.json({ ok: true, id, calories_burned: kcal }, 201)
})

app.delete('/exercise/:id', requireAuth, async (c) => {
  const uid = c.get('userId')
  const id = c.req.param('id')
  const r = await c.env.DB.prepare('DELETE FROM exercise_logs WHERE id = ? AND user_id = ?')
    .bind(id, uid)
    .run()
  if ((r.meta.changes ?? 0) === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

// ---------- photo upload (R2) ----------

const MAX_PHOTO_BYTES = 6 * 1024 * 1024

app.post('/photo/upload', requireAuth, async (c) => {
  const uid = c.get('userId')
  const form = await c.req.formData().catch(() => null)
  const entry = form?.get('file') as unknown
  if (!entry || typeof entry === 'string') return c.json({ error: 'file is required' }, 400)
  const file = entry as File
  const type = file.type || 'image/jpeg'
  if (!type.startsWith('image/')) return c.json({ error: 'file must be an image' }, 400)
  if (file.size > MAX_PHOTO_BYTES) return c.json({ error: 'image too large (max 6 MB)' }, 413)
  // Namespace by user so one user cannot reference another user's photo on estimate.
  const key = `${uid}/${crypto.randomUUID()}`
  await c.env.BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } })
  return c.json({ photo_key: key }, 201)
})

// ---------- AI estimate (Anthropic vision, server-side only) ----------

const FOOD_SYSTEM_PROMPT = `You are a nutrition estimation assistant. You receive one photo of food, optionally with the restaurant name and a description, and return a calorie and macronutrient estimate.

Rules:
- Identify each distinct food item visible.
- If a restaurant is named and you recognize it or the dish as a known menu item with published nutrition, anchor your estimate to those published values and say so in notes. Otherwise estimate from the image.
- Use the description to resolve ambiguity (hidden ingredients, preparation, what is under the surface).
- Estimate portions using visible references for scale (plate, utensils, hands). State portions in plain units.
- Give per-item calories, protein, carbs, and fat in grams.
- Be realistic, not optimistic. Restaurant portions are usually larger and higher in oil and butter than they look.
- Set confidence to "low" when portion or identity is genuinely uncertain. Naming the restaurant and dish should raise confidence.
- Do not write any prose outside the JSON. Do not use markdown code fences.

Return ONLY a JSON object with this exact shape:
{
  "items": [
    {"name": string, "portion": string, "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number}
  ],
  "total": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number},
  "confidence": "low" | "medium" | "high",
  "notes": string
}`

app.post('/estimate', requireAuth, async (c) => {
  const uid = c.get('userId')
  const body = await c.req.json().catch(() => null)
  const photoKey = body?.photo_key
  const restaurant = typeof body?.restaurant === 'string' ? body.restaurant.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  if (typeof photoKey !== 'string' || !photoKey) return c.json({ error: 'photo_key required' }, 400)
  if (!photoKey.startsWith(`${uid}/`)) return c.json({ error: 'photo not found' }, 404)
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI is not configured on this server' }, 503)

  const obj = await c.env.BUCKET.get(photoKey)
  if (!obj) return c.json({ error: 'photo not found' }, 404)
  const b64 = bytesToBase64(new Uint8Array(await obj.arrayBuffer()))
  const mediaType = obj.httpMetadata?.contentType ?? 'image/jpeg'

  const ctx: string[] = []
  if (restaurant) ctx.push(`Restaurant: ${restaurant}.`)
  if (description) ctx.push(`User description: ${description}.`)
  const userText = (ctx.join(' ') + ' Estimate the calories and macros for this meal.').trim()

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': c.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: FOOD_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: userText },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return c.json({ error: 'model call failed', status: res.status, detail: detail.slice(0, 300) }, 502)
  }

  const data = await res.json<{ content?: Array<{ type: string; text?: string }> }>()
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  const parsed = parseEstimateText(text)
  if (!parsed) return c.json({ error: 'could not parse estimate', raw: text.slice(0, 500) }, 422)
  return c.json(parsed)
})

// ---------- barcode lookup (Open Food Facts) ----------

app.get('/barcode/:code', requireAuth, async (c) => {
  const code = c.req.param('code')
  if (!/^\d{6,14}$/.test(code)) return c.json({ found: false, error: 'invalid barcode' }, 400)

  let d: any
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json`, {
      headers: { 'User-Agent': 'Tally/1.0 (https://tally-6dz.pages.dev)' },
    })
    if (!r.ok) return c.json({ found: false }, 404)
    d = await r.json()
  } catch {
    return c.json({ found: false }, 404)
  }
  if (!d || d.status !== 1 || !d.product) return c.json({ found: false }, 404)

  const p = d.product
  const n = p.nutriments ?? {}
  // Open Food Facts gives per-100g and sometimes per-serving. Prefer per-serving.
  const perServing = n['energy-kcal_serving'] != null
  return c.json({
    found: true,
    name: p.product_name || p.generic_name || 'Unknown product',
    barcode: code,
    basis: perServing ? 'serving' : '100g',
    serving_text: p.serving_size ?? null,
    calories: perServing ? n['energy-kcal_serving'] : (n['energy-kcal_100g'] ?? null),
    protein_g: perServing ? (n.proteins_serving ?? null) : (n.proteins_100g ?? null),
    carbs_g: perServing ? (n.carbohydrates_serving ?? null) : (n.carbohydrates_100g ?? null),
    fat_g: perServing ? (n.fat_serving ?? null) : (n.fat_100g ?? null),
  })
})

export const onRequest = handle(app)
