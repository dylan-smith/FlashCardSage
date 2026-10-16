import { apiBaseUrl } from '../config'
import { sameText } from '../lib/text'
import { refreshCounts } from '../state/counts'
import {
  ResponseError,
  apiFetch,
  deleteGone,
  getJson,
  sendJson,
} from './client'

export const deckNameRequiredMessage = 'Deck name is required.'

// The most a deck name can be, as the API allows.
export const deckNameMaxLength = 50

// A named set of the user's cards to practice, such as Food or Week 1. The API sends its card ids in card order.
export type Deck = {
  id: number
  name: string
  flashCardIds: number[]
}

// What's sent to make a deck. It can start out with cards, such as the ones picked on the cards page.
export type DeckFields = {
  name: string
  flashCardIds: number[]
}

// Cards to put in a deck and take out of it. A deck can hold hundreds, so only the ones that change are sent.
export type DeckCardsChange = {
  add?: number[]
  remove?: number[]
}

export const decksUrl = `${apiBaseUrl}/api/decks`

// The user's decks in name order.
export function listDecks() {
  return getJson<Deck[]>(decksUrl, 'Unable to load decks.')
}

// The deck, or null when the user has no deck with that id (any more).
export async function getDeck(id: number): Promise<Deck | null> {
  const response = await apiFetch(`${decksUrl}/${id}`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new ResponseError(response.status, 'Unable to load the deck.')
  }
  return (await response.json()) as Deck
}

export async function createDeck(fields: DeckFields) {
  const deck = await sendJson<Deck>(
    'POST',
    decksUrl,
    fields,
    'Unable to save deck.',
  )
  refreshCounts()
  return deck
}

// Renames the deck, leaving its cards as they are.
export function renameDeck(id: number, name: string) {
  return sendJson<Deck>(
    'PUT',
    `${decksUrl}/${id}`,
    { name },
    'Unable to rename deck.',
  )
}

// Returns the deck with all its cards after the change.
export function changeDeckCards(id: number, change: DeckCardsChange) {
  return sendJson<Deck>(
    'PATCH',
    `${decksUrl}/${id}/cards`,
    { add: change.add ?? [], remove: change.remove ?? [] },
    'Unable to change the deck.',
  )
}

// Puts the cards in the user's deck with this name, whatever its case (as the API matches names), making the deck if
// they don't have one. Returns the deck with all its cards.
export async function addToNamedDeck(name: string, ids: number[]) {
  const existing = (await listDecks()).find((deck) => sameText(deck.name, name))
  return existing
    ? changeDeckCards(existing.id, { add: ids })
    : createDeck({ name, flashCardIds: ids })
}

// Leaves the deck's cards as they are.
export async function deleteDeck(id: number) {
  await deleteGone(`${decksUrl}/${id}`, 'Unable to delete deck.')
  refreshCounts()
}
