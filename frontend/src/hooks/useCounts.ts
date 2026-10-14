import { useSyncExternalStore } from 'react'
import { getCounts } from '../api/counts'
import type { Counts } from '../api/counts'
import { trackException } from '../telemetry'

// How many cards, decks and tags the signed-in user has, shown in the navigation, or null until they've loaded. The
// app loads them when the user signs in (see App), and the API calls that add or remove any load them again.

type Listener = () => void

const listeners = new Set<Listener>()

let current: Counts | null = null

// Goes up with each load and when the counts are cleared, so only the latest load's counts are kept, and one that
// finishes after the user signs out is dropped.
let generation = 0

function setCounts(counts: Counts | null) {
  if (counts === current) {
    return
  }
  current = counts
  listeners.forEach((listener) => listener())
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function currentCounts() {
  return current
}

export function useCounts() {
  return useSyncExternalStore(subscribe, currentCounts)
}

// Loads the counts. When they can't be loaded, the ones already shown (if any) stay until the next load.
export function refreshCounts() {
  const load = ++generation
  getCounts()
    .then((counts) => {
      if (load === generation) {
        setCounts(counts)
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
  setCounts(null)
}
