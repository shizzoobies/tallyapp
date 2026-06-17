# Tally, build handoff

A mobile-first PWA weight loss tracker on the Cloudflare stack. Scan a barcode or photograph a restaurant meal, get an editable calorie estimate, log it against a daily budget, and track a smoothed weight trend.

## What is in here

| File | Purpose |
|---|---|
| `CLAUDE.md` | Always-loaded rules and conventions for Claude Code |
| `SPEC.md` | Full build specification: stack, math, schema, API, AI flows, phases, acceptance |
| `KICKOFF.md` | The exact prompt to paste into Claude Code to start |
| `schema.sql` | D1 schema, ready to apply |
| `wrangler.toml` | Cloudflare Pages bindings template |
| `.gitignore` | Repo ignores |

## Setup

```
git init
git add .
git commit -m "Tally build handoff"
# create the remote repo on GitHub (account: shizzoobies), then:
# git remote add origin git@github.com:shizzoobies/tally.git
# git push -u origin main
```

Then open the folder in Claude Code and paste the block from `KICKOFF.md`.

## Provisioning Cloudflare (before Phase 0 deploy)

```
npx wrangler d1 create tally          # paste the returned database_id into wrangler.toml
npx wrangler r2 bucket create tally-photos
```

Local AI key goes in `.dev.vars`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## The one rule worth repeating

No em dashes anywhere, in code, copy, comments, or commits. It is in CLAUDE.md so Claude Code keeps it, but it is on you in commit messages and any manual edits.
