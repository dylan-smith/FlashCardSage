import { apiBaseUrl } from '../config'
import { apiFetch } from './client'
import { throwIfNotSaved } from './flashCards'

// A named set of the user's cards to practice, such as Food or Week 1. The API sends its card ids in card order.
export type Deck = {
  id: number
  name: string
  flashCardIds: number[]
}

// What's sent when a deck is created or changed. The ids are every card in the deck, replacing the ones it had.
export type DeckFields = {
  name: string
  flashCardIds: number[]
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

async function saveDeck(
  url: string,
  method: 'POST' | 'PUT',
  fields: DeckFields,
) {
  const response = await apiFetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fields),
  })
  await throwIfNotSaved(response, 'Unable to save deck.')
  return (await response.json()) as Deck
}

export function createDeck(fields: DeckFields) {
  return saveDeck(decksUrl, 'POST', fields)
}

export function updateDeck(id: number, fields: DeckFields) {
  return saveDeck(`${decksUrl}/${id}`, 'PUT', fields)
}

// Leaves the deck's cards as they are. A 404 means the deck is already gone, which is what the caller wanted.
export async function deleteDeck(id: number) {
  const response = await apiFetch(`${decksUrl}/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 404) {
    throw new Error('Unable to delete deck.')
  }
}
