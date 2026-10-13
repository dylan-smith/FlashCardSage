import { apiBaseUrl } from '../config'
import { apiFetch } from './client'
import type { Deck } from './decks'
import { throwIfNotSaved } from './flashCards'

// A card on a built-in deck. The user doesn't have it, so it's sent in full.
export type SystemDeckCard = {
  spanish: string
  english: string
  tags: string[]
}

// A built-in deck any user can import, with its cards in order.
export type SystemDeck = {
  id: number
  name: string
  cards: SystemDeckCard[]
}

// The user's new deck, made from a built-in one, and how many of its cards were left out because the user already
// has a card with the same Spanish or English.
export type SystemDeckImport = {
  deck: Deck
  importedCount: number
  skippedCount: number
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
export async function importSystemDeck(id: number): Promise<SystemDeckImport> {
  const response = await apiFetch(`${systemDecksUrl}/${id}/import`, {
    method: 'POST',
  })
  await throwIfNotSaved(response, 'Unable to add the deck.')
  return (await response.json()) as SystemDeckImport
}
