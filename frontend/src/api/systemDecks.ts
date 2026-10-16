import { apiBaseUrl } from '../config'
import { refreshCounts } from '../hooks/useCounts'
import { apiFetch } from './client'
import type { Deck } from './decks'
import { throwIfNotSaved } from './flashCards'
import type { FlashCard } from './flashCards'

// A built-in deck any user can import, with its cards in order. The user doesn't have them, so they're sent in full,
// like the user's own cards.
export type SystemDeck = {
  id: number
  name: string
  cards: FlashCard[]
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
  refreshCounts()
  return (await response.json()) as SystemDeckImport
}

// The user's deck a built-in card was copied into, which is new unless they already had a deck with the built-in
// deck's name, and the copy.
export type SystemDeckCardImport = {
  deck: Deck
  deckCreated: boolean
  card: FlashCard
}

// Copies one of the built-in deck's cards into the user's deck with its name, making that deck if they haven't got it.
export async function importSystemDeckCard(
  deckId: number,
  cardId: number,
): Promise<SystemDeckCardImport> {
  const response = await apiFetch(
    `${systemDecksUrl}/${deckId}/cards/${cardId}/import`,
    { method: 'POST' },
  )
  await throwIfNotSaved(response, 'Unable to add the card.')
  refreshCounts()
  return (await response.json()) as SystemDeckCardImport
}
