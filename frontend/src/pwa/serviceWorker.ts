import { createStore } from '../lib/store'
import { trackException } from '../telemetry'

// An installed app can stay open for days, coming back from the background rather than loading again, and the browser
// only looks for a new service worker when a page loads. So the app looks too: when it comes back into view, and now
// and then while it's open.
export const updateCheckIntervalMs = 60 * 60 * 1000

// Whether a new version has taken over from the one this page was loaded from, so a reload would show it.
export const updateReady = createStore(false)

// Registers the service worker (sw/sw.ts), which keeps the app so it opens offline. Only built apps have one: the dev
// server serves the source, which the service worker would keep stale.
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(watchForUpdates)
      .catch((error: unknown) => {
        trackException(error, { operation: 'registerServiceWorker' })
      })
  })
}

// A new service worker takes over as soon as it's installed (sw/sw.ts), but this page still runs the version it was
// loaded with, so it offers to reload. The first service worker also takes over a page that had none, which isn't a
// new version.
export function watchForUpdates(registration: ServiceWorkerRegistration) {
  let controlled = navigator.serviceWorker.controller !== null
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) {
      updateReady.set(true)
    }
    controlled = true
  })

  const checkForUpdate = () => {
    if (navigator.onLine && !registration.installing) {
      // A failed check, such as on a poor connection, is tried again at the next one.
      registration.update().catch(() => undefined)
    }
  }
  window.setInterval(checkForUpdate, updateCheckIntervalMs)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForUpdate()
    }
  })
}

// Loads the new version. It's on its own so tests can stand in for it, since jsdom can't reload the page.
export function reloadPage() {
  window.location.reload()
}
