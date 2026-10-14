import { apiBaseUrl } from '../config'
import { refreshCounts } from '../hooks/useCounts'
import { apiFetch } from './client'
import type { DeckImport } from './decks'
import { throwIfNotSaved } from './flashCards'
import type { FlashCard } from './flashCards'

// A built-in deck any user can import, with its cards in order. The user doesn't have them, so they're sent in full,
// like the user's own cards.
export type SystemDeck = {
  id: number
  name: string
  cards: FlashCard[]
}

export const systemDecksUrl = `${apiBaseUrl}/api/system-decks`

// The built-in decks in name order.
export async function listSystemDecks(): Promise<SystemDeck[]> {
  const response = await apiFetch(systemDecksUrl)
  if (!response.ok) {
    throw new Error('Unable to load the built-in decks.')
  }
  return (await response.json()) as SystemDeck[]
}

// Copies the built-in deck, its cards and their tags into the user's own, so it's then like a deck they made.
export async function importSystemDeck(id: number): Promise<DeckImport> {
  const response = await apiFetch(`${systemDecksUrl}/${id}/import`, {
    method: 'POST',
  })
  await throwIfNotSaved(response, 'Unable to add the deck.')
  refreshCounts()
  return (await response.json()) as DeckImport
}
