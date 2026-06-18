# MBS Tally, build handoff and continuation

This file is the single place to resume work after clearing context. `SPEC.md` remains the source of truth for the app's behavior and math. `CLAUDE.md` holds the always-on rules. This file captures current state, how to run and ship, and the next epic (native apps).

No em dashes anywhere, in code, copy, comments, or commits. Use commas, colons, or restructure.

---

## 1. What this is

MBS Tally is a mobile-first PWA calorie and weight tracker, branded for the clinic **Mind Body & Spirit Medicine** (MBS Medical, mbsdoc.com, veteran-owned Florida telehealth) and offered as part of their patient plans. Scan a barcode or photograph a restaurant meal, get an editable calorie and macro estimate, log it against a daily budget, and track a smoothed weight trend.

- **Live:** https://tally-6dz.pages.dev
- **Repo:** https://github.com/shizzoobies/tallyapp (branch `main`)
- **Status:** Phases 0 through 5 complete, plus an age-field change and the MBS Tally rebrand. Feature complete for v1 (manual, MET-based activity). All work is committed and deployed.

---

## 2. Stack

Vite + React 18 + TypeScript PWA. Cloudflare Pages with Pages Functions (Hono) for the API. Cloudflare D1 (SQLite) for data, R2 for food photos. Anthropic Messages API (vision) server-side only for photo estimates. Recharts 2.x for charts, @zxing/browser for the barcode fallback, vite-plugin-pwa (Workbox) for the service worker and manifest. Auth is email + password with PBKDF2 (Web Crypto) and an HttpOnly session cookie in D1.

---

## 3. Cloudflare resources (already provisioned)

- **Account:** `c8f0f7697e2801ba2acabb700b5da793` (wrangler is logged in via OAuth on this machine).
- **D1:** database `tally`, id `fb280ff2-0198-4cb3-95b9-0c168847dfbf` (set in `wrangler.toml`). Schema in `schema.sql`, applied to both local and remote.
- **R2:** bucket `tally-photos`.
- **Pages project:** `tally`, serving `tally-6dz.pages.dev`.
- **Secret:** `ANTHROPIC_API_KEY` is set as a production Pages secret and verified bound. Local dev reads it from `.dev.vars` (gitignored).

---

## 4. Commands

```
npm install
npm run dev      # vite build --watch + wrangler pages dev dist --live-reload, http://127.0.0.1:8788
npm test         # vitest, 30 unit tests (calc + estimate)
npm run build    # vite build (also generates the service worker + manifest)
npm run icons    # regenerate PNG icons from public/favicon.svg (uses @resvg/resvg-js)
npm run db:local                                          # apply schema.sql to local D1
npm run db:remote                                         # apply schema.sql to remote D1

# Deploy (run after every change you want live):
npm run build
npx wrangler pages deploy --project-name tally --branch main --commit-dirty=true
```

Type-check both sides before shipping:
```
npx tsc --noEmit -p tsconfig.json            # the React app
npx tsc --noEmit -p functions/tsconfig.json  # the Worker functions
```

---

## 5. Source layout

```
functions/api/[[route]].ts   The entire Hono API (one catch-all file): auth, me, weight,
                             day, food, exercise, photo upload, estimate, barcode, weights, history
functions/tsconfig.json      Worker types config (@cloudflare/workers-types)
src/lib/calc.ts(+test)       BMR, TDEE, dailyTarget, exerciseKcal, remaining, trendSeries (EWMA),
                             ageOn (now unused), linregSlope, daysToGoal
src/lib/mets.ts              MET table for exercise burn
src/lib/estimate.ts(+test)   Tolerant parser for the AI estimate JSON
src/lib/units.ts             kg/lb and cm/ft-in conversions (UI edge only)
src/lib/image.ts             Client-side downscale to 1024px JPEG before photo upload
src/api.ts                   Client API wrapper + shared types (Me, Day, FoodLog, etc.)
src/screens/*                Auth, Setup, Today, AddFood, AddExercise, LogWeight, SnapMeal, ScanFood, Trends
src/components/*             Sheet (bottom-sheet modal), CalorieRing, InstallPrompt
src/App.tsx, main.tsx        App shell + state-based routing (loading/auth/setup/home/trends)
src/styles.css               All styles + brand CSS variables
public/                      favicon.svg + generated icon PNGs
scripts/gen-icons.mjs        SVG to PNG icon generator
schema.sql, wrangler.toml, vite.config.ts, package.json
```

---

## 6. API routes (all JSON, all auth-gated except /api/auth/*)

```
POST   /api/auth/register | login | logout      session cookie
GET    /api/me                                   profile + computed tdee + daily_target
PATCH  /api/me                                   profile fields (sex, age, height_cm, activity, goals, units, exercise_credit_pct)
POST   /api/weight        {date, weight_kg}      upsert per day
GET    /api/day/:date                            weight, foods, exercises, target, consumed, burned, remaining
POST   /api/food          | PATCH /api/food/:id | DELETE /api/food/:id
POST   /api/exercise      | DELETE /api/exercise/:id   (burn computed server-side from MET table + latest weight)
POST   /api/photo/upload  multipart -> R2, returns {photo_key} (namespaced by user id)
POST   /api/estimate      {photo_key, restaurant?, description?} -> Anthropic vision, returns a draft (does not save)
GET    /api/barcode/:code                         Open Food Facts lookup, normalized
GET    /api/weights[?from=&to=]                   date-sorted weights with server-computed EWMA trend
GET    /api/history?from=&to=                     per-day consumed + burned
```

---

## 7. Data model (D1, see schema.sql)

`users` (id, email, pw_hash, pw_salt, sex, height_cm, **age** INTEGER, activity, goal_weight_kg, goal_rate_kg_per_week, exercise_credit_pct, units, created_at), `sessions` (token, user_id, expires_at), `weight_logs` (id, user_id, log_date, weight_kg, created_at; UNIQUE(user_id, log_date)), `food_logs` (... calories, macros, source manual|ai|db, restaurant, barcode, photo_key, ai_raw_json), `exercise_logs` (id, user_id, log_date, activity_key, duration_min, calories_burned).

Note: profile uses **age** (whole years), not date of birth. The `ageOn` helper in calc.ts is now unused but kept and still tested.

---

## 8. Design decisions that must not be "fixed" (detail in SPEC section 3)

- AI photo calories are an editable draft, never truth. Always show the confirm sheet. Store raw model output in `ai_raw_json`, separate from the user-confirmed values that drive the math.
- Weight is an EWMA trend (alpha 0.1), not raw daily readings. Goal-pace feedback reads the trend.
- Exercise burn is shown but NOT credited to the eating budget unless `exercise_credit_pct` is raised (default 0).
- Store bodyweight in kg and height in cm; convert only in the UI based on `user.units`.
- The Anthropic key never reaches the client; the only AI route is `/api/estimate`.
- Never save a null calorie value; a null lookup drops the user into manual entry.

---

## 9. Branding (MBS Tally)

Matched to mbsdoc.com. Palette (CSS vars in `src/styles.css`):

- `--bg` cream `#f9f7f2`, `--ink` warm charcoal `#3c3836`, `--muted` `#8a847d`
- `--accent` deep charcoal `#2d2d2a` (primary buttons + dark surfaces)
- `--sage` `#7d8c7b` (calorie ring, charts, highlights), `--sage-deep` `#566b52` (links/emphasis)
- `--danger` warm red `#b3473f`, `--line` `#ece8e0`

Fonts: Lora (serif headings) + DM Sans (body), via Google Fonts in `index.html`. Chart and ring colors are hardcoded brand hex inside `CalorieRing.tsx` and `Trends.tsx` (update there, not just the CSS vars). App icon is the tally glyph (cream strokes + sage diagonal on a charcoal rounded square); regenerate with `npm run icons` after editing `public/favicon.svg`. Login shows "MBS Tally" + a "Mind Body & Spirit Medicine" tagline; Today has a footer credit.

---

## 10. NEXT EPIC: native apps (iOS-first)

Goal: Apple Watch and other health-device data, which a PWA cannot read. Approach is **Capacitor** wrapping the existing web app plus health plugins, talking to the same Cloudflare API. No rewrite.

User's setup: in the Apple Developer Program, has an iPhone + Apple Watch, MacBook Air arriving around the weekend of 2026-06-20. Needs to borrow an Android device later ($25 Google Play account when ready).

### Do these first (all doable on Windows, before the Mac, NOT yet started)
1. **In-app account deletion.** Apple requires any app with login to delete its own account. Add a delete-account endpoint (cascade the user's rows + R2 photos + sessions) and a button in Profile.
2. **Privacy policy page** at `/privacy` (mandatory for health-data apps on both stores). Static page on the existing site.
3. **Token-based auth for native.** The HttpOnly session cookie will NOT cross the native WebView origin to the API, so add a Bearer-token path (issue a token on login, store it on-device, accept `Authorization: Bearer` alongside the cookie). The existing web cookie flow stays as-is.

### Once the Mac is here
4. Add Capacitor, bundle `dist` into the iOS shell (bundle the assets, do not point the WebView at the remote URL, or Apple may reject it as "just a website").
5. Wire **HealthKit** (iOS) to read steps, active energy, workouts, heart rate, and body weight, then push to the API. Apple Watch data arrives through Apple Health automatically. Community Capacitor health plugins vary in quality; budget time, possibly custom native code. Test on the real iPhone + Watch.
6. Open in Xcode, run on device, add the HealthKit usage-description strings, then push to TestFlight.
7. **Android follow-on:** add the Android platform (Android Studio works on Windows), wire **Health Connect**, test on a borrowed device, ship to Play.

### Native gotchas
- Imported active-calorie burn must still respect `exercise_credit_pct` (decision 3.3); wearable burn is overestimated too.
- Likely bundle id `com.mbsdoc.tally`.
- iOS cannot be built or signed from Windows; needs the Mac (or a cloud Mac / CI like Codemagic or EAS).

### Costs (mostly covered)
Apple Developer Program (have it), Google Play $25 once, the Mac (arriving). Testing uses the user's own devices.

---

## 11. Deferred / pre-public-launch hardening (no scheduled date)

- Rate limiting on the auth routes.
- Raise the PBKDF2 iteration count (currently 100k; OWASP suggests higher, kept modest for Workers CPU limits).
- Per-user daily cap on `/api/estimate` (each call is a paid vision request).
- Cleanup of orphaned R2 photos (abandoned estimates leave objects); add an R2 lifecycle rule.
- Offline logging + sync (the spec lists this as a nice-to-have, not v1).
- Recharts v3 upgrade (currently 2.x, deprecation warning only).
- Register returns 409 on an existing email (accepted enumeration tradeoff for v1).

---

## 12. Working conventions and gotchas learned

- **Verify every phase with evidence:** tsc on both configs, `npm test`, `npm run build`, then a live local flow with curl, then redeploy. The acceptance criteria live in SPEC section 10.
- **Local D1 is keyed by `database_id`.** After changing the id in wrangler.toml, re-run `npm run db:local` to recreate local tables.
- **Dev server:** the wrangler v4 `pages dev -- <command>` proxy form is deprecated and exits on Windows. We use `vite build --watch` + `wrangler pages dev dist --live-reload` via `concurrently` (the `npm run dev` script).
- **Auth review tip:** a dedicated security-review subagent returned empty output here; the auth review was done inline. Do a focused manual security pass on any new auth/token code.
- **Browser checks:** Playwright (MCP) was used to verify the service worker (offline shell) and the rebrand visually. Useful for PWA and visual confirmation.
- Secrets: local in `.dev.vars` (gitignored). Production via `npx wrangler pages secret put ANTHROPIC_API_KEY --project-name tally`.

---

## 13. Kickoff prompt for the next session

Paste this to resume:

```
Read HANDOFF.md, then SPEC.md and CLAUDE.md. MBS Tally (Phases 0 to 5 + rebrand)
is built and live at tally-6dz.pages.dev. We are starting the native-app epic,
iOS-first with Capacitor + HealthKit.

Begin with the Windows-doable prep in HANDOFF.md section 10: (1) in-app account
deletion, (2) a /privacy policy page, (3) token-based auth for native. Build and
verify each on the local stack, keep the no-em-dash rule, then redeploy. Stop
after these three and tell me how to verify before we move to the Capacitor shell.
```
