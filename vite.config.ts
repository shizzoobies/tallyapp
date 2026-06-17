import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite serves the React app. Cloudflare Pages Functions in functions/ provide the API.
// During local dev, wrangler pages dev runs this and proxies to it (see package.json dev script).
export default defineConfig({
  plugins: [react()],
})
