// The service worker that lets FlashCardSage open with no connection. It keeps the app itself (index.html and the
// built files) in one cache, and the pictures of cards in another, and leaves everything else, such as the API and
// Google sign-in, to the network. The build writes it to dist/sw.js, unhashed, so its URL stays the same, and
// replaces the '__PRECACHE__' literal with the paths of this build's files (see vite.config.ts).
declare const self: ServiceWorkerGlobalScope

const precache = '__PRECACHE__' as unknown as string[]
const precached = new Set(precache)
const shellCache = 'flashcardsage-shell'
// Also filled by the page itself, which keeps every picture of the user's cards for offline practice.
const picturesCache = 'flashcardsage-pictures'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(shellCache)
      // The hashed files under assets/ never change, so the browser's own cache can supply them. Everything else is
      // fetched afresh, so a new index.html never comes from the browser's cache.
      await cache.addAll(
        precache.map(
          (path) =>
            new Request(path, {
              cache: path.startsWith('/assets/') ? 'default' : 'reload',
            }),
        ),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop the files of earlier builds.
      const cache = await caches.open(shellCache)
      for (const request of await cache.keys()) {
        if (!precached.has(new URL(request.url).pathname)) {
          await cache.delete(request)
        }
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') {
    return
  }
  const url = new URL(request.url)
  if (request.mode === 'navigate') {
    // Every page is the same index.html, so a deep link opens offline too, and never sees the host's 404 page.
    event.respondWith(fromShell('/index.html', request))
  } else if (url.origin === self.location.origin) {
    if (precached.has(url.pathname)) {
      event.respondWith(fromShell(url.pathname, request))
    }
  } else if (request.destination === 'image') {
    event.respondWith(picture(request))
  }
  // Anything else isn't answered here, so it goes to the network as if there were no service worker.
})

async function fromShell(path: string, request: Request) {
  const cache = await caches.open(shellCache)
  return (await cache.match(path)) ?? fetch(request)
}

// A card's picture, from the cache when it's there. Pictures are served with Vary: Origin, and the page keeps them
// with a CORS request while <img> asks without one, so the cache ignores Vary. Only a response that's ok is kept: an
// opaque one (from a request without CORS) can't be checked, and Chromium counts each one as megabytes of quota.
async function picture(request: Request) {
  const cache = await caches.open(picturesCache)
  const cached = await cache.match(request, { ignoreVary: true })
  if (cached) {
    return cached
  }
  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
  }
  return response
}
