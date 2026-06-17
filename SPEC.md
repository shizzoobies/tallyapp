# Build Handoff: Weight Loss Tracker (codename "Tally")

Rename freely. This document is the single source of truth for the initial build. Build in the phase order at the bottom. Do not skip the design decisions section, several features have a wrong-but-obvious implementation that this spec deliberately routes around.

Writing rule for any user-facing copy, comments, or docs you generate: no em dashes anywhere. Use commas, colons, or restructure.

---

## 1. What this is

A mobile-first web app (installable PWA) that helps a user lose weight by tracking three things and turning them into one daily number:

1. Bodyweight over time
2. Calories consumed (manual entry, food database lookup, or AI photo estimate)
3. Activity / exercise (manual entry, MET-based calorie burn)

The headline experience is: open the app, either scan a barcode for packaged food or snap a photo of a restaurant meal (naming the restaurant and dish to sharpen the estimate), get an editable calorie + macro estimate, confirm, and watch the daily budget update.

---

## 2. Stack (locked)

This matches the existing toolchain. Do not introduce a new platform.

| Layer | Choice |
|---|---|
| Frontend | Vite + React + TypeScript, deployed as a PWA |
| Hosting | Cloudflare Pages |
| API | Cloudflare Pages Functions (Workers runtime), framework: Hono |
| Database | Cloudflare D1 (SQLite) |
| File storage | Cloudflare R2 (food photos) |
| AI | Anthropic Messages API, server-side only, key in a Worker secret |
| Auth | Email + password, PBKDF2 via Web Crypto, HttpOnly session cookie stored in D1 |
| Charts | Recharts |

No API key ever touches the client. All Anthropic calls go through a Pages Function.

---

## 3. Design decisions worth knowing (read before coding)

These are the non-obvious calls. Each one exists because the naive version is misleading or broken.

**3.1 AI photo calories are estimates, not truth.**
Photo-to-calorie estimation has real error, commonly 20 to 40 percent, because portion size and density cannot be read reliably from a flat image. Do not present the number as authoritative. The AI result is a draft the user edits before it is saved. Store the raw AI output and the user-confirmed values in separate columns so we can later measure drift and improve the prompt. Default the food log to the user-confirmed numbers, never the raw AI numbers.

**3.2 Daily scale weight is noise. Track the trend, not the reading.**
Bodyweight swings several pounds day to day from water and food in transit. Showing raw daily weight makes users panic and quit. Compute an exponentially weighted moving average (EWMA) trend line and drive all goal-pace feedback off the trend, not the latest reading. Show the raw dots faintly and the trend line boldly.

`trend_today = trend_prev + alpha * (weight_today - trend_prev)`, alpha = 0.1. Seed `trend_prev` with the first logged weight.

**3.3 Do not auto-credit exercise calories back into the food budget by default.**
Exercise burn is systematically overestimated, and "eating back" exercise calories is the single most common reason calorie tracking fails. Default behavior: show exercise burn separately and credit zero back into the eating budget. Expose a setting `exercise_credit_pct` (default 0) that advanced users can raise to 50 or 100 if they insist. The daily budget math reads this setting.

**3.4 No automatic step counting in v1.**
A web PWA cannot reliably read HealthKit or Google Fit step data. v1 activity is manual, MET-based. If automatic device sync becomes a hard requirement, that forces a native wrapper (Capacitor) and is a separate project. Flag this to Alex rather than faking it.

**3.5 Store everything metric internally, convert at the edge.**
Weight in kg, height in cm. Convert to lb/ft-in only in the UI based on `user.units`. This avoids rounding drift.

---

## 4. Core math (implement as a shared `lib/calc.ts`)

```ts
// Mifflin-St Jeor BMR
export function bmr(sex: 'male'|'female', kg: number, cm: number, age: number): number {
  const base = 10 * kg + 6.25 * cm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

const ACTIVITY: Record<string, number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725, extra: 1.9,
};

export function tdee(bmrVal: number, activity: keyof typeof ACTIVITY): number {
  return bmrVal * ACTIVITY[activity];
}

// goalRateKgPerWeek is negative for loss (e.g. -0.5). 7700 kcal per kg.
export function dailyTarget(tdeeVal: number, goalRateKgPerWeek: number, sex: 'male'|'female'): number {
  const dailyDelta = (goalRateKgPerWeek * 7700) / 7;
  const floor = sex === 'male' ? 1500 : 1200; // hard safety floor
  return Math.max(Math.round(tdeeVal + dailyDelta), floor);
}

// MET-based burn. kcal = MET * kg * hours
export function exerciseKcal(met: number, kg: number, minutes: number): number {
  return Math.round(met * kg * (minutes / 60));
}

// Remaining eating budget for the day
export function remaining(target: number, consumed: number, burned: number, creditPct: number): number {
  return Math.round(target - consumed + burned * (creditPct / 100));
}

// EWMA weight trend, fold over date-sorted weights
export function trendSeries(weightsKg: number[], alpha = 0.1): number[] {
  const out: number[] = [];
  weightsKg.forEach((w, i) => {
    out.push(i === 0 ? w : out[i - 1] + alpha * (w - out[i - 1]));
  });
  return out;
}
```

Seed MET table (`lib/mets.ts`), extend later:

```ts
export const METS = [
  { key: 'walk_slow', label: 'Walking, casual (3.0 km/h)', met: 2.8 },
  { key: 'walk_brisk', label: 'Walking, brisk (5.6 km/h)', met: 4.3 },
  { key: 'run_easy', label: 'Running (8 km/h)', met: 8.3 },
  { key: 'run_fast', label: 'Running (12 km/h)', met: 11.8 },
  { key: 'cycle_mod', label: 'Cycling, moderate', met: 7.5 },
  { key: 'strength', label: 'Weight training, vigorous', met: 6.0 },
  { key: 'elliptical', label: 'Elliptical, moderate', met: 5.0 },
  { key: 'yoga', label: 'Yoga', met: 3.0 },
  { key: 'swim', label: 'Swimming, moderate', met: 5.8 },
  { key: 'hiit', label: 'HIIT / circuit', met: 8.0 },
];
```

---

## 5. Data model (D1, `schema.sql`)

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,            -- uuid
  email         TEXT UNIQUE NOT NULL,
  pw_hash       TEXT NOT NULL,               -- pbkdf2 hash
  pw_salt       TEXT NOT NULL,
  sex           TEXT CHECK (sex IN ('male','female')),
  height_cm     REAL,
  birthdate     TEXT,                        -- ISO date
  activity      TEXT DEFAULT 'sedentary',
  goal_weight_kg REAL,
  goal_rate_kg_per_week REAL DEFAULT -0.5,
  exercise_credit_pct INTEGER DEFAULT 0,
  units         TEXT DEFAULT 'imperial',     -- 'imperial' | 'metric'
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE weight_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  log_date   TEXT NOT NULL,                  -- ISO date, one per day enforced in app
  weight_kg  REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_weight_user_date ON weight_logs(user_id, log_date);

CREATE TABLE food_logs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  log_date     TEXT NOT NULL,
  meal         TEXT,                          -- breakfast|lunch|dinner|snack
  name         TEXT NOT NULL,
  calories     REAL NOT NULL,                 -- user-confirmed, drives all math
  protein_g    REAL DEFAULT 0,
  carbs_g      REAL DEFAULT 0,
  fat_g        REAL DEFAULT 0,
  source       TEXT NOT NULL,                 -- 'manual' | 'ai' | 'db'
  restaurant   TEXT,                           -- free text context for ai source, nullable
  barcode      TEXT,                           -- EAN/UPC for db source, nullable
  photo_key    TEXT,                          -- R2 object key, nullable
  ai_raw_json  TEXT,                          -- raw model output for ai source
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_food_user_date ON food_logs(user_id, log_date);

CREATE TABLE exercise_logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  log_date        TEXT NOT NULL,
  activity_key    TEXT NOT NULL,
  duration_min    INTEGER NOT NULL,
  calories_burned INTEGER NOT NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_ex_user_date ON exercise_logs(user_id, log_date);
```

---

## 6. API surface (Hono routes, all JSON, all auth-gated except auth/*)

```
POST   /api/auth/register      {email, password} -> sets session cookie
POST   /api/auth/login         {email, password} -> sets session cookie
POST   /api/auth/logout
GET    /api/me                 -> user profile + computed tdee + dailyTarget
PATCH  /api/me                 profile fields (sex, height, activity, goal, etc.)

GET    /api/day/:date          -> { weight, foods[], exercises[], target, consumed, burned, remaining }
GET    /api/weights?from=&to=  -> [{date, weight_kg, trend_kg}]   (server computes trend)

POST   /api/weight             {date, weight_kg}   (upsert per date)
POST   /api/food               {date, meal, name, calories, macros..., source, photo_key?, ai_raw_json?}
PATCH  /api/food/:id
DELETE /api/food/:id
POST   /api/exercise           {date, activity_key, duration_min}  (server computes burn from user weight)
DELETE /api/exercise/:id

POST   /api/photo/upload       multipart -> stores to R2, returns {photo_key}
GET    /api/barcode/:code       -> Open Food Facts lookup, normalized prefill (does NOT save)
POST   /api/estimate           {photo_key, restaurant?, description?} -> AI food estimate JSON (does NOT save)
```

`/api/barcode/:code` and `/api/estimate` both return a draft. The client shows it in an editable confirm sheet. Saving calls `/api/food` with the user-confirmed values plus the matching `source`, and whichever context applies (`photo_key` + `restaurant` + `ai_raw_json` for photos, `barcode` for scans).

---

## 7. Logging food: three input methods

Three ways to add a food log. All three converge on the same editable confirm sheet before anything saves, and all three write to `food_logs` with the user-confirmed numbers driving the math. Pick the right tool for the situation: barcode for packaged, photo for restaurant meals, manual for everything else.

### 7.1 Method A: Barcode scan (packaged food, most accurate)

For anything with a barcode, do not use AI. A real barcode decoder plus a product database is faster, cheaper, and more accurate than reading a barcode photo with vision.

Flow:
1. "Scan barcode" opens a live camera scanner.
2. Decode client-side. Use the native `BarcodeDetector` API where available, fall back to `@zxing/browser` (`decodeFromVideoDevice`) everywhere else. Both read EAN/UPC.
3. On a successful decode, call `/api/barcode/:code`.
4. Server looks the code up in Open Food Facts (free, no key, millions of products) and normalizes nutriments to a serving.
5. Editable confirm sheet, user sets quantity, saves with `source: 'db'` and the barcode stored.

Server route (`functions/api/barcode.ts`):

```ts
app.get('/api/barcode/:code', async (c) => {
  const code = c.req.param('code');
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json`, {
    headers: { 'User-Agent': 'Tally/1.0 (contact: you@example.com)' },
  });
  if (!r.ok) return c.json({ found: false }, 404);
  const d = await r.json<any>();
  if (d.status !== 1 || !d.product) return c.json({ found: false }, 404);

  const p = d.product;
  const n = p.nutriments ?? {};
  // OFF gives per-100g and sometimes per-serving. Prefer per-serving when present.
  const perServing = n['energy-kcal_serving'] != null;
  return c.json({
    found: true,
    name: p.product_name || p.generic_name || 'Unknown product',
    barcode: code,
    basis: perServing ? 'serving' : '100g',
    serving_text: p.serving_size ?? null,
    calories: perServing ? n['energy-kcal_serving'] : n['energy-kcal_100g'] ?? null,
    protein_g: perServing ? n.proteins_serving : n.proteins_100g ?? null,
    carbs_g: perServing ? n.carbohydrates_serving : n.carbohydrates_100g ?? null,
    fat_g: perServing ? n.fat_serving : n.fat_100g ?? null,
  });
});
```

Confirm-sheet rules: if `basis` is `100g`, label the numbers "per 100 g" and make the user enter grams eaten so the sheet scales. If `serving`, default quantity to 1 serving. Open Food Facts is crowd-sourced and often missing fields, so any null field must drop the user into manual entry. Never save a null calorie value.

### 7.2 Method B: Photo estimate with restaurant context (eating out)

The headline feature for restaurant meals. Letting the user name the restaurant and the dish materially improves the estimate, because the model can anchor to a known menu item and its published nutrition instead of guessing from pixels alone.

Flow:
1. "Snap a meal" opens the camera (`<input type="file" accept="image/*" capture="environment">`, plus drag-drop on desktop).
2. Two optional fields: **Restaurant** (free text, e.g. "Chipotle", "local diner") and **What is it** (free text, e.g. "chicken burrito bowl, no rice"). Both optional, both passed to the model.
3. Client downscales to 1024px long edge, JPEG-compresses, uploads to `/api/photo/upload`, gets a `photo_key`.
4. Client calls `/api/estimate` with `{ photo_key, restaurant?, description? }`.
5. Editable confirm sheet with per-item numbers, total, confidence badge.
6. Save with `source: 'ai'`, `photo_key`, `restaurant`, and `ai_raw_json`.

Handler (`functions/api/estimate.ts`):

```ts
import { Hono } from 'hono';

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
}`;

type Bindings = { DB: D1Database; BUCKET: R2Bucket; ANTHROPIC_API_KEY: string };
const app = new Hono<{ Bindings: Bindings }>();

app.post('/api/estimate', async (c) => {
  const { photo_key, restaurant, description } = await c.req.json<{
    photo_key: string; restaurant?: string; description?: string;
  }>();
  if (!photo_key) return c.json({ error: 'photo_key required' }, 400);

  const obj = await c.env.BUCKET.get(photo_key);
  if (!obj) return c.json({ error: 'photo not found' }, 404);

  const bytes = new Uint8Array(await obj.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  const b64 = btoa(binary);
  const mediaType = obj.httpMetadata?.contentType ?? 'image/jpeg';

  const ctx: string[] = [];
  if (restaurant) ctx.push(`Restaurant: ${restaurant}.`);
  if (description) ctx.push(`User description: ${description}.`);
  const userText = (ctx.join(' ') + ' Estimate the calories and macros for this meal.').trim();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': c.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',          // good cost/accuracy for vision. Use claude-opus-4-8 for max accuracy at higher cost.
      max_tokens: 1024,
      system: FOOD_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: userText },
        ],
      }],
    }),
  });

  if (!res.ok) return c.json({ error: 'model call failed', status: res.status }, 502);

  const data = await res.json<any>();
  const text = (data.content ?? [])
    .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    .replace(/```json|```/g, '').trim();

  try { return c.json(JSON.parse(text)); }
  catch { return c.json({ error: 'could not parse estimate', raw: text }, 422); }
});

export default app;
```

### 7.3 Method C: Manual entry

Name, calories, optional macros, meal slot. The always-available fallback, and the backstop whenever a barcode is missing from Open Food Facts or a lookup returns nulls.

### 7.4 Accuracy notes (honest)

- Barcode plus database beats photo for anything packaged. When the user is logging a packaged item, steer them to the scanner.
- Restaurant naming genuinely helps the photo estimate for chains with published nutrition. For an unknown local place it helps less, and the model falls back to estimating from the image, so keep the confidence badge honest.
- The model's recall of published nutrition can be stale or wrong. The editable sheet is still the backstop. Never present any number as final before the user confirms.
- Downscale photos to 1024px before upload (client-side). Saves R2 cost and tokens, accuracy barely changes above that size.
- Persist `ai_raw_json`, `restaurant`, and `barcode`. These are what let you later measure where estimates miss, tune the prompt, and steer users between methods. It is free to store and the only path to improving the estimator.

---

## 8. Frontend (PWA)

Screens:

- **Today** (home): big remaining-calories ring, today weight, today foods grouped by meal, today exercise, a prominent "Snap a meal" button and a "+ Add food" / "+ Add exercise" row.
- **Camera result sheet**: editable AI estimate (section 7.1 step 5).
- **Add food (manual)**: name, calories, optional macros, meal slot.
- **Add exercise**: activity dropdown (MET table), minutes, auto-computed burn shown live.
- **Weight**: number entry, plus the trend chart (faint daily dots, bold EWMA line, goal line).
- **Trends**: weight trend, daily calories vs target bar history, projected goal date from current trend slope.
- **Profile / setup**: sex, height, birthdate, activity level, current weight, goal weight, goal rate, units, `exercise_credit_pct`.

PWA requirements: `manifest.json` with icons, a service worker that caches the app shell for offline open, `apple-mobile-web-app-capable` meta. Log entry should work offline and sync when back online is a nice-to-have, not v1.

Onboarding: first launch routes to Profile setup. Without sex, height, birthdate, activity, and goal, the daily target cannot be computed, so gate the Today screen until those exist.

---

## 9. Build phases

Build and verify each phase before starting the next.

**Phase 0: Scaffold**
Vite React TS app, Hono Pages Functions, D1 binding, R2 binding, `schema.sql` applied via `wrangler d1 execute`. Wrangler config with bindings. Deploys to Pages and returns 200 on `/api/me` (401 when unauthenticated).

**Phase 1: Auth + profile + core math**
Register, login, logout, session cookie. Profile setup screen. `lib/calc.ts` with unit tests for bmr, tdee, dailyTarget, exerciseKcal, remaining, trendSeries. `/api/me` returns computed target.

**Phase 2: Manual logging + Today screen**
Weight, manual food, exercise logging end to end. Today screen with live remaining-calories budget. Exercise burn computed server-side from the user's latest weight.

**Phase 3: Photo estimate with restaurant context**
R2 upload, client downscale, optional restaurant + description fields, `/api/estimate`, editable result sheet, save as `source: 'ai'`. Store raw JSON, restaurant, photo_key. Confidence badge.

**Phase 3.5: Barcode scan + Open Food Facts**
Live camera scanner (`BarcodeDetector` with `@zxing/browser` fallback), `/api/barcode/:code`, normalized prefill, quantity scaling for per-100g products, save as `source: 'db'` with barcode. Null fields fall through to manual entry.

**Phase 4: Trends + charts**
Weight EWMA trend chart, calories-vs-target history, projected goal date. Settings for units and `exercise_credit_pct` wired into the math.

**Phase 5: PWA polish**
Manifest, icons, service worker app-shell cache, install prompt, mobile layout pass.

---

## 10. Acceptance criteria (per phase, must pass before moving on)

- P0: `wrangler dev` runs, schema applies clean, unauthenticated `/api/me` is 401.
- P1: A new user can register, complete setup, and see a correct daily target hand-checked against the Mifflin-St Jeor math for one sample profile.
- P2: Logging 600 kcal of food and a 30-minute brisk walk on a 1800 kcal target shows remaining = 1200 (credit_pct 0), and remaining is unchanged by the walk until credit_pct is raised.
- P3: Uploading a photo of a plated meal with a restaurant name returns parseable JSON with at least one item and a total, the sheet is editable, the model's notes reference the restaurant when recognized, and saving writes a food_log with source 'ai', a photo_key, a restaurant, and non-null ai_raw_json.
- P3.5: Scanning a real grocery barcode prefills name and calories from Open Food Facts, a per-100g product scales correctly when grams are entered, a missing/unknown barcode routes cleanly to manual entry, and saving writes source 'db' with the barcode stored.
- P4: Trend line is visibly smoother than raw dots, and projected goal date matches a manual slope calculation within a few days.
- P5: App installs to home screen and opens offline to the cached shell.

---

## 11. Secrets and config

```
# Worker secrets (wrangler secret put)
ANTHROPIC_API_KEY

# wrangler.toml bindings
[[d1_databases]]   binding = "DB"     database_name = "tally"
[[r2_buckets]]     binding = "BUCKET" bucket_name = "tally-photos"
```

Never expose `ANTHROPIC_API_KEY` to the client. The only AI path is the server `/api/estimate` route.

---

## 12. Open decisions for Alex (do not block the build, default chosen)

1. **Single-user personal tool, or a real multi-user product?** Spec assumes multi-user with auth. If it is just you, auth can be a single hardcoded account and Phase 1 shrinks.
2. **Barcode provider:** defaulting to Open Food Facts (free, no key, strong on groceries). Coverage on US-only and store-brand items is patchier than commercial APIs. If coverage frustrates you in testing, the fallback is USDA FoodData Central or a paid provider like Nutritionix, which also adds a restaurant-menu database that could back Method B for chains.
3. **Vision model:** defaulting to claude-sonnet-4-6 for cost. Bump to claude-opus-4-8 if early testing shows portion estimates are too rough to be useful.
4. **Native step counting:** out of scope per 3.4. If you want it, that is a Capacitor wrapper decision and a separate handoff.
