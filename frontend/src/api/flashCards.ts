import { apiBaseUrl } from '../config'
import { refreshCounts } from '../hooks/useCounts'
import { apiFetch } from './client'

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

// The body of a 400 from the API, with the messages for each invalid field.
type ValidationErrorResponse = {
  errors?: Record<string, string[]>
}

// The body of another error from the API, such as a 409 for a card the user already has.
type ProblemResponse = {
  detail?: string
}

const duplicateMessage =
  'You already have a flash card with this Spanish or English.'

// Thrown for a response the caller should show to the user as is, such as a 400 for a blank translation.
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// fetch rejects with a TypeError when the API can't be reached at all, including while a deployment has
// it paused (see the deploy-backend job in ci.yml), so tell the user to retry rather than show a generic error.
export const unreachableMessage =
  "Can't reach FlashCardSage right now. It may be updating, so try again in a minute."

export function describeFetchError(error: unknown, fallback: string) {
  if (error instanceof TypeError) {
    return unreachableMessage
  }
  return error instanceof ApiError ? error.message : fallback
}

const flashCardsUrl = `${apiBaseUrl}/api/flashcards`

export async function listFlashCards(): Promise<FlashCard[]> {
  const response = await apiFetch(flashCardsUrl)
  if (!response.ok) {
    throw new Error('Unable to load flash cards.')
  }
  return (await response.json()) as FlashCard[]
}

async function saveFlashCard(
  url: string,
  method: 'POST' | 'PUT',
  fields: FlashCardFields,
) {
  const response = await apiFetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fields),
  })

  await throwIfNotSaved(response, 'Unable to save flash card.')
  // A new card, or a new name on a card, adds to the counts.
  refreshCounts()
  return (await response.json()) as FlashCard
}

// Throws for a save that didn't go through. A 400 says what's wrong with what was sent, so that's passed on.
export async function throwIfNotSaved(response: Response, fallback: string) {
  if (response.status === 400) {
    const error = (await response.json()) as ValidationErrorResponse
    const message = Object.values(error.errors ?? {}).flat()[0]
    throw new ApiError(400, message ?? fallback)
  }
  // A 409 means the user already has this card.
  if (response.status === 409) {
    const problem = (await response.json()) as ProblemResponse
    throw new ApiError(409, problem.detail ?? duplicateMessage)
  }
  if (!response.ok) {
    throw new Error(fallback)
  }
}

export function createFlashCard(fields: FlashCardFields) {
  return saveFlashCard(flashCardsUrl, 'POST', fields)
}

export function updateFlashCard(id: number, fields: FlashCardFields) {
  return saveFlashCard(`${flashCardsUrl}/${id}`, 'PUT', fields)
}

// A 404 means the card is already gone, which is what the caller wanted.
export async function deleteFlashCard(id: number) {
  const response = await apiFetch(`${flashCardsUrl}/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 404) {
    throw new Error('Unable to delete flash card.')
  }
  refreshCounts()
}

// Deletes many cards at once. The API skips any that are already gone, which is what the caller wanted.
export async function deleteFlashCards(ids: number[]) {
  const response = await apiFetch(`${flashCardsUrl}/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ flashCardIds: ids }),
  })
  if (!response.ok) {
    throw new Error('Unable to delete the flash cards.')
  }
}

// How the user did at a card in practice mode, by the name the API stores.
export type PracticeOutcome = 'GotIt' | 'WasClose' | 'Failed'

// The side of a card shown first in practice, by the name the API sends.
export type PracticeSide = 'Spanish' | 'English'

// A card the API picked to practice, and the side to show first. Its picture, if it has one, is shown once the
// card is revealed.
export type PracticeCard = FlashCardWords & {
  side: PracticeSide
  imageUrl: string | null
}

// Which cards to practice: a deck's, a tag's, or all of them when it's empty.
export type PracticeSelection = { deckId?: number; tagId?: number }

// The selection as a query string, starting with ? unless it's empty.
function practiceQuery({ deckId, tagId }: PracticeSelection) {
  const params = new URLSearchParams()
  if (deckId !== undefined) {
    params.set('deckId', String(deckId))
  }
  if (tagId !== undefined) {
    params.set('tagId', String(tagId))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

// The card to start practicing with, or null when there are no cards in the selection.
export async function getNextPracticeCard(
  selection: PracticeSelection = {},
): Promise<PracticeCard | null> {
  const response = await apiFetch(
    `${flashCardsUrl}/practice/next${practiceQuery(selection)}`,
  )
  if (!response.ok) {
    throw new Error('Unable to load flash cards.')
  }
  return response.status === 204
    ? null
    : ((await response.json()) as PracticeCard)
}

// The card to practice next, and how much the answer raised or lowered the answered card's score. There's no next
// card when the deck or tag being practiced has lost all its cards since practice started.
export type PracticeResult = {
  next: PracticeCard | null
  scoreChange: number
}

// Records the answer, and picks the next card from the same selection.
export async function recordPracticeResult(
  id: number,
  outcome: PracticeOutcome,
  selection: PracticeSelection = {},
): Promise<PracticeResult> {
  const url = `${flashCardsUrl}/${id}/practice-results${practiceQuery(selection)}`
  const response = await apiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ outcome }),
  })
  if (!response.ok) {
    throw new Error('Unable to save your answer.')
  }
  return (await response.json()) as PracticeResult
}

// A card's score out of 100, from how many times in a row it was last answered with Got it! in practice.
export type FlashCardScore = FlashCardWords & {
  score: number
}

// Every card's score, lowest first, and the total out of the most the cards could score.
export type FlashCardScores = {
  total: number
  maximum: number
  cards: FlashCardScore[]
}

export async function listFlashCardScores(): Promise<FlashCardScores> {
  const response = await apiFetch(`${flashCardsUrl}/scores`)
  if (!response.ok) {
    throw new Error('Unable to load scores.')
  }
  return (await response.json()) as FlashCardScores
}
