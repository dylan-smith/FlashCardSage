import { apiBaseUrl } from '../config'
import { refreshCounts } from '../hooks/useCounts'
import { apiFetch } from './client'
import { throwIfNotSaved } from './flashCards'

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
export async function listDecks(): Promise<Deck[]> {
  const response = await apiFetch(decksUrl)
  if (!response.ok) {
    throw new Error('Unable to load decks.')
  }
  return (await response.json()) as Deck[]
}

// The deck, or null when the user has no deck with that id (any more).
export async function getDeck(id: number): Promise<Deck | null> {
  const response = await apiFetch(`${decksUrl}/${id}`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error('Unable to load the deck.')
  }
  return (await response.json()) as Deck
}

async function sendDeck(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH',
  body: unknown,
  fallback: string,
) {
  const response = await apiFetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  await throwIfNotSaved(response, fallback)
  return (await response.json()) as Deck
}

export async function createDeck(fields: DeckFields) {
  const deck = await sendDeck(decksUrl, 'POST', fields, 'Unable to save deck.')
  refreshCounts()
  return deck
}

// Renames the deck, leaving its cards as they are.
export function renameDeck(id: number, name: string) {
  return sendDeck(
    `${decksUrl}/${id}`,
    'PUT',
    { name },
    'Unable to rename deck.',
  )
}

// Returns the deck with all its cards after the change.
export function changeDeckCards(id: number, change: DeckCardsChange) {
  return sendDeck(
    `${decksUrl}/${id}/cards`,
    'PATCH',
    { add: change.add ?? [], remove: change.remove ?? [] },
    'Unable to change the deck.',
  )
}

// Puts the cards in the user's deck with this name, whatever its case (as the API matches names), making the deck if
// they don't have one. Returns the deck with all its cards.
export async function addToNamedDeck(name: string, ids: number[]) {
  const existing = (await listDecks()).find(
    (deck) =>
      deck.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
  )
  return existing
    ? changeDeckCards(existing.id, { add: ids })
    : createDeck({ name, flashCardIds: ids })
}

// Leaves the deck's cards as they are. A 404 means the deck is already gone, which is what the caller wanted.
export async function deleteDeck(id: number) {
  const response = await apiFetch(`${decksUrl}/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 404) {
    throw new Error('Unable to delete deck.')
  }
  refreshCounts()
}
