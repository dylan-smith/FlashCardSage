import { getCounts } from '../api/counts'
import type { Counts } from '../api/counts'
import { createStore } from '../lib/store'
import { trackException } from '../telemetry'

// How many cards, decks and tags the signed-in user has, shown in the navigation, or null until they've loaded. The
// app loads them when the user signs in (see App), and the API calls that add or remove any load them again.
export const countsStore = createStore<Counts | null>(null)

// Goes up with each load and when the counts are cleared, so only the latest load's counts are kept, and one that
// finishes after the user signs out is dropped.
let generation = 0

// Loads the counts. When they can't be loaded, the ones already shown (if any) stay until the next load.
export function refreshCounts() {
  const load = ++generation
  getCounts()
    .then((counts) => {
      if (load === generation) {
        countsStore.set(counts)
      }
    })
    .catch((error: unknown) => {
      if (load === generation) {
        trackException(error, { operation: 'refreshCounts' })
      }
    })
}

export function clearCounts() {
  generation++
  countsStore.set(null)
}
