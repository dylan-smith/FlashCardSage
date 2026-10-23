import { apiBaseUrl } from '../config'
import { refreshCounts } from '../state/counts'
import {
  deleteGone,
  fetchOk,
  getJson,
  jsonRequest,
  sendJson,
  withQuery,
} from './client'

// A name the user puts on cards to organize them, such as Food or Travel.
export type Tag = {
  id: number
  name: string
}

// A card's words, which is all practice and scores need. Each side has one or more words for the same meaning, in
// the order the user put them in (e.g. "solo" and "únicamente" for "only").
export type FlashCardWords = {
  id: number
  spanish: string[]
  english: string[]
}

// The most words a side of a card can have, the same as the API's limit.
export const maxWordsPerSide = 10

// The most a word can be, the same as the API's limit.
export const maxWordLength = 200

// A side's words as one line, the way a card shows them, such as "solo / únicamente".
export function formatWords(words: string[]) {
  return words.join(' / ')
}

// The API sends a card's tags in name order. imageUrl is the card's picture, or null for a card without one.
export type FlashCard = FlashCardWords & {
  tags: Tag[]
  imageUrl: string | null
}

// What the user types in for a card, sent when it's created or changed. Each side is a list of words, and the API
// leaves out blank ones. Tags are by name, and a new name makes a new tag.
export type FlashCardFields = {
  spanish: string[]
  english: string[]
  tags: string[]
}

// How a new card was added, by the name the API stores. The API takes Manual when none is sent, and records the others
// it can be (built-in decks, AI assistants and shared deck files) itself.
export type CardSource =
  'Manual' | 'Suggested' | 'Document' | 'Preply' | 'Duolingo'

export const flashCardsUrl = `${apiBaseUrl}/api/flashcards`

export function listFlashCards() {
  return getJson<FlashCard[]>(flashCardsUrl, 'Unable to load flash cards.')
}

async function saveFlashCard(
  url: string,
  method: 'POST' | 'PUT',
  body: FlashCardFields & { source?: CardSource },
) {
  const card = await sendJson<FlashCard>(
    method,
    url,
    body,
    'Unable to save flash card.',
  )
  // A new card, or a new name on a card, adds to the counts.
  refreshCounts()
  return card
}

export function createFlashCard(fields: FlashCardFields, source?: CardSource) {
  return saveFlashCard(flashCardsUrl, 'POST', { ...fields, source })
}

export function updateFlashCard(id: number, fields: FlashCardFields) {
  return saveFlashCard(`${flashCardsUrl}/${id}`, 'PUT', fields)
}

// The cards that were added all at once, and how many were left out because the user already has a card with the same
// Spanish or English, or an earlier card in the list does.
export type FlashCardBatch = {
  cards: FlashCard[]
  skippedCount: number
}

// Adds the cards, such as the ones scanned from a document, in one request.
export function createFlashCards(
  cards: FlashCardFields[],
  source?: CardSource,
) {
  return sendJson<FlashCardBatch>(
    'POST',
    `${flashCardsUrl}/batch`,
    { cards, source },
    'Unable to add the cards.',
  )
}

export async function deleteFlashCard(id: number) {
  await deleteGone(`${flashCardsUrl}/${id}`, 'Unable to delete flash card.')
  refreshCounts()
}

// Deletes many cards at once. The API skips any that are already gone, which is what the caller wanted.
export async function deleteFlashCards(ids: number[]) {
  await fetchOk(
    `${flashCardsUrl}/delete`,
    'Unable to delete the flash cards.',
    jsonRequest('POST', { flashCardIds: ids }),
  )
  refreshCounts()
}

// How the user did at a card in practice mode, by the name the API stores.
export type PracticeOutcome = 'GotIt' | 'WasClose' | 'Failed'

// The side of a card shown first in practice.
export type PracticeSide = 'Spanish' | 'English'

// A card picked to practice, and the side to show first. Its picture, if it has one, is shown once the card is
// revealed.
export type PracticeCard = FlashCardWords & {
  side: PracticeSide
  imageUrl: string | null
}

// Which cards to practice or score: a deck's, a tag's, or all of them when it's empty.
export type PracticeSelection = { deckId?: number; tagId?: number }

// The URL for the selection's cards.
function practiceUrl(path: string, { deckId, tagId }: PracticeSelection) {
  return withQuery(`${flashCardsUrl}/${path}`, { deckId, tagId })
}

// A card's score out of 100, from how many times in a row it was last answered with Got it! in practice, how many
// times it was answered with each outcome, and when it was last practiced (null if never). imageUrl is its picture, or
// null for a card without one.
export type FlashCardScore = FlashCardWords & {
  score: number
  gotIt: number
  wasClose: number
  failed: number
  lastPracticedAt: string | null
  imageUrl: string | null
}

// Each card's score in the selection, lowest first, and the total out of the most those cards could score.
export type FlashCardScores = {
  total: number
  maximum: number
  cards: FlashCardScore[]
}

export function listFlashCardScores(selection: PracticeSelection = {}) {
  return getJson<FlashCardScores>(
    practiceUrl('scores', selection),
    'Unable to load scores.',
  )
}
