import { apiBaseUrl } from '../config'
import { refreshCounts } from '../state/counts'
import { getJson, sendJson } from './client'
import type { Deck } from './decks'
import type { FlashCard } from './flashCards'

// A built-in deck any user can import, with its cards in order. The user doesn't have them, so they're sent in full,
// like the user's own cards. The owned ids are the cards the user already has a word of, which importing leaves out.
export type SystemDeck = {
  id: number
  name: string
  cards: FlashCard[]
  ownedCardIds: number[]
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
export function listSystemDecks() {
  return getJson<SystemDeck[]>(
    systemDecksUrl,
    'Unable to load the built-in decks.',
  )
}

// Copies the built-in deck, its cards and their tags into the user's own, so it's then like a deck they made.
export async function importSystemDeck(id: number) {
  const imported = await sendJson<SystemDeckImport>(
    'POST',
    `${systemDecksUrl}/${id}/import`,
    undefined,
    'Unable to add the deck.',
  )
  refreshCounts()
  return imported
}

// The user's deck a built-in card was copied into, which is new unless they already had a deck with the built-in
// deck's name, and the copy.
export type SystemDeckCardImport = {
  deck: Deck
  deckCreated: boolean
  card: FlashCard
}

// Copies one of the built-in deck's cards into the user's deck with its name, making that deck if they haven't got it.
export async function importSystemDeckCard(deckId: number, cardId: number) {
  const imported = await sendJson<SystemDeckCardImport>(
    'POST',
    `${systemDecksUrl}/${deckId}/cards/${cardId}/import`,
    undefined,
    'Unable to add the card.',
  )
  refreshCounts()
  return imported
}
