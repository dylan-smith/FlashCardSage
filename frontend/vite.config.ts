import { configDefaults, defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The files in public/ that the service worker keeps, so the app opens offline. Vite copies them as they are, so
// they aren't in the bundle.
const precachedPublicFiles = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
]

// Gives the service worker (sw/sw.ts, built to sw.js) the list of files to keep: index.html, the files above and
// this build's hashed files, in place of its '__PRECACHE__' literal.
function serviceWorkerPrecache(): Plugin {
  return {
    name: 'flashcardsage-sw-precache',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const sw = bundle['sw.js']
      if (sw?.type !== 'chunk') {
        this.error('The build has no sw.js.')
      }
      const hashed = Object.keys(bundle)
        .filter((file) => file.startsWith('assets/') && !file.endsWith('.map'))
        .sort()
        .map((file) => `/${file}`)
      const precache = ['/index.html', ...precachedPublicFiles, ...hashed]
      // The minifier may change the literal's quotes, but keeps the literal.
      const code = sw.code.replace(
        /(["'`])__PRECACHE__\1/g,
        JSON.stringify(precache),
      )
      if (code === sw.code) {
        this.error("sw.js has no '__PRECACHE__' literal to replace.")
      }
      sw.code = code
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorkerPrecache()],
  build: {
    rolldownOptions: {
      input: { index: 'index.html', sw: 'sw/sw.ts' },
      output: {
        // The service worker's URL can't change between builds, so it isn't hashed, and it's at the root so it can
        // control every page.
        entryFileNames: (chunk) =>
          chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
    exclude: [...configDefaults.exclude, 'e2e/**'],
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'vitest-report/results.xml' },
    // Only collected when run with --coverage, as CI does.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.test.{ts,tsx}'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
})
