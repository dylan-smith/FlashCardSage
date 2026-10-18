import { countsStore } from '../state/counts'

// How many cards, decks and tags the signed-in user has, or null until they've loaded (see state/counts).
export function useCounts() {
  return countsStore.use()
}
