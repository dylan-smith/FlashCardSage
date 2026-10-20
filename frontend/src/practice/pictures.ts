import type { PracticePack } from '../api/practice'
import { trackException } from '../telemetry'

// The cache the cards' pictures are kept in on the device, so practice shows them offline. The service worker answers
// the pictures' requests from it.
export const picturesCacheName = 'flashcardsage-pictures'

// How many pictures are fetched at once.
const concurrency = 4

// The run in progress, and the pack to run with once it's done, if a newer one came in meanwhile.
let running: Promise<void> | null = null
let nextPack: PracticePack | null = null

// Keeps every picture on the pack's cards in the cache, fetching the ones it doesn't have yet, and drops the ones no
// card has any more. A picture that can't be fetched is left for the next time.
export function cachePictures(pack: PracticePack): Promise<void> {
  if (typeof caches === 'undefined') {
    return Promise.resolve()
  }
  if (running !== null) {
    nextPack = pack
    return running
  }
  running = (async () => {
    let current: PracticePack | null = pack
    while (current !== null) {
      nextPack = null
      try {
        await cacheAll(current)
      } catch (error) {
        trackException(error, { operation: 'cachePictures' })
      }
      current = nextPack
    }
  })().finally(() => {
    running = null
  })
  return running
}

async function cacheAll(pack: PracticePack) {
  const cache = await caches.open(picturesCacheName)
  const urls = new Set(
    pack.cards.flatMap((card) =>
      card.imageUrl === null
        ? []
        : [new URL(card.imageUrl, window.location.href).href],
    ),
  )

  const cached = new Set<string>()
  for (const request of await cache.keys()) {
    if (urls.has(request.url)) {
      cached.add(request.url)
    } else {
      await cache.delete(request)
    }
  }

  const missing = [...urls].filter((url) => !cached.has(url))
  let next = 0
  async function fetchMissing() {
    while (next < missing.length) {
      const url = missing[next++]
      try {
        // A cors response can be checked, where an opaque one can't, and doesn't take up far more space than it needs.
        const response = await fetch(url, { mode: 'cors' })
        if (response.ok) {
          await cache.put(url, response)
        }
      } catch {
        // The picture is fetched again next time.
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, fetchMissing))
}
