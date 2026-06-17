# CLAUDE.md

Project: Tally, a mobile-first PWA weight loss tracker. Scan a barcode or photograph a restaurant meal, get an editable calorie and macro estimate, log it against a daily budget, and track a smoothed weight trend.

Full build spec is in `SPEC.md`. Read it in full before writing code. This file is the short list of rules that always apply.

## Workflow (phase gate)

- Build one phase at a time, in the order defined in SPEC section 9.
- After each phase, stop at the acceptance criteria in SPEC section 10, tell the user how to verify, and wait for "go" before the next phase.
- Never build ahead of the current phase. Do not scaffold future phases early.

## Non-negotiable conventions

- No em dashes. Anywhere. Code comments, UI copy, commit messages, docs. Use commas, colons, or restructure.
- Store all bodyweight in kg and height in cm. Convert to imperial only in the UI based on `user.units`.
- The Anthropic API key never reaches the client. Every model call goes through a Pages Function. The only AI route is `/api/estimate`.
- User-confirmed food values drive all math. Raw AI output is stored separately in `ai_raw_json` and is never used for the budget.
- Never save a null calorie value. A null from a lookup drops the user into manual entry.

## Design decisions you must not "fix" (detail in SPEC section 3)

- AI photo calories are an editable draft, not truth. Always show an editable confirm sheet before saving.
- Weight is tracked as an EWMA trend (alpha 0.1), not raw daily readings. Goal-pace feedback reads the trend.
- Exercise calories are not credited back into the eating budget by default (`exercise_credit_pct` defaults to 0).
- No automatic step counting in v1. Activity is manual and MET-based.
- Barcodes are decoded client-side and looked up in Open Food Facts. Do not send barcode photos to the AI.

## Stack

Vite + React + TypeScript PWA, deployed to Cloudflare Pages. API via Pages Functions using Hono. Cloudflare D1 (SQLite) for data, R2 for food photos, Recharts for charts. Auth is email + password with PBKDF2 (Web Crypto) and an HttpOnly session cookie in D1.

## Commands

```
npm run dev                                   # vite + pages functions locally
npx wrangler d1 execute tally --file schema.sql --local   # apply schema locally
npx wrangler d1 execute tally --file schema.sql --remote  # apply schema to prod
npx wrangler pages deploy dist                # deploy
```

Local secrets go in `.dev.vars` (gitignored): `ANTHROPIC_API_KEY=...`. Production secret: `npx wrangler pages secret put ANTHROPIC_API_KEY`.

## Source layout (target)

```
/functions/api/*      Hono routes (auth, me, day, weight, food, exercise, photo, estimate, barcode)
/src/lib/calc.ts      shared math (BMR, TDEE, target, MET burn, EWMA trend)
/src/lib/mets.ts      MET table
/src/screens/*        Today, Camera result, Add food, Add exercise, Weight, Trends, Profile
/schema.sql           D1 schema
/wrangler.toml        bindings
```
