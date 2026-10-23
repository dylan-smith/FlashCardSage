import { apiBaseUrl } from '../config'
import { sameText } from '../lib/text'
import { refreshCounts } from '../state/counts'
import { saveFile } from '../lib/saveFile'
import {
  ApiError,
  ResponseError,
  apiFetch,
  deleteGone,
  fetchOk,
  getJson,
  sendJson,
  throwIfNotSaved,
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

// The user's new deck from a deck file someone shared, how many of its cards are new, how many they had already (which
// went in the deck as they are), how many were left out for repeating another card in the file, and how many came
// without their picture because it isn't on this site.
export type DeckImport = {
  deck: Deck
  importedCount: number
  existingCount: number
  skippedCount: number
  missingPictureCount: number
}

// The kinds of file a deck is shared as, for the file picker.
export const deckFileTypes = '.yml,.yaml,.zip'

// The biggest deck file the API takes, in bytes.
export const maxDeckFileBytes = 50 * 1024 * 1024

// Saves the deck as a file to share: a .yml file, or a .zip of it and the pictures the user put on its cards themselves.
// Generated pictures are named by their id, so they don't make it a zip.
export async function exportDeck(deck: Deck) {
  const response = await fetchOk(
    `${decksUrl}/${deck.id}/export`,
    'Unable to export the deck.',
  )
  const zip = response.headers.get('Content-Type') === 'application/zip'
  saveFile(await response.blob(), `${deck.name}.${zip ? 'zip' : 'yml'}`)
}

// Makes a new deck from a deck file someone shared. A file the API can't import throws an ApiError that says why.
export async function importDeckFile(file: File) {
  if (file.size > maxDeckFileBytes) {
    throw new ApiError(413, 'Choose a deck file under 50 MB.')
  }
  const body = new FormData()
  body.append('file', file)
  const response = await apiFetch(`${decksUrl}/import`, {
    method: 'POST',
    body,
  })
  await throwIfNotSaved(response, 'Unable to import the deck.')
  refreshCounts()
  return (await response.json()) as DeckImport
}

// Leaves the deck's cards as they are.
export async function deleteDeck(id: number) {
  await deleteGone(`${decksUrl}/${id}`, 'Unable to delete deck.')
  refreshCounts()
}
