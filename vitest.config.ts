import { defineConfig } from 'vitest/config'

// Math tests are pure and run in node. Kept separate from vite.config.ts so the
// React plugin is not loaded for unit tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
