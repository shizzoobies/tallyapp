import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'

// Bindings come from wrangler.toml (DB, BUCKET) and Worker secrets (ANTHROPIC_API_KEY).
type Bindings = {
  DB: D1Database
  BUCKET: R2Bucket
  ANTHROPIC_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>().basePath('/api')

// Phase 0: auth is not wired yet, so the protected profile route reports unauthenticated.
// Phases 1+ will replace this with real session handling.
app.get('/me', (c) => c.json({ error: 'unauthenticated' }, 401))

export const onRequest = handle(app)
