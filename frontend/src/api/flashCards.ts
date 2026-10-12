import { apiBaseUrl } from '../config'
import { apiFetch } from './client'

// A name the user puts on cards to organize them, such as Food or Travel.
export type Tag = {
  id: number
  name: string
}

// A card's words, which is all practice and scores need.
export type FlashCardWords = {
  id: number
  spanish: string
  english: string
}

// The API sends a card's tags in name order.
export type FlashCard = FlashCardWords & {
  tags: Tag[]
}

// What the user types in for a card, sent when it's created or changed. Tags are by name, and a new name makes a
// new tag.
export type FlashCardFields = {
  spanish: string
  english: string
  tags: string[]
}

// The body of a 400 from the API, with the messages for each invalid field.
type ValidationErrorResponse = {
  errors?: Record<string, string[]>
}

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
  return (await response.json()) as FlashCard
}

// Throws for a save that didn't go through. A 400 says what's wrong with what was sent, so that's passed on.
export async function throwIfNotSaved(response: Response, fallback: string) {
  if (response.status === 400) {
    const error = (await response.json()) as ValidationErrorResponse
    const message = Object.values(error.errors ?? {}).flat()[0]
    throw new ApiError(400, message ?? fallback)
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
}

// How the user did at a card in practice mode, by the name the API stores.
export type PracticeOutcome = 'GotIt' | 'WasClose' | 'Failed'

// The side of a card shown first in practice, by the name the API sends.
export type PracticeSide = 'Spanish' | 'English'

// A card the API picked to practice, and the side to show first.
export type PracticeCard = FlashCardWords & {
  side: PracticeSide
}

// The card to start practicing with, or null when there are no cards.
export async function getNextPracticeCard(): Promise<PracticeCard | null> {
  const response = await apiFetch(`${flashCardsUrl}/practice/next`)
  if (!response.ok) {
    throw new Error('Unable to load flash cards.')
  }
  return response.status === 204
    ? null
    : ((await response.json()) as PracticeCard)
}

// Records the answer and returns the card to practice next.
export async function recordPracticeResult(
  id: number,
  outcome: PracticeOutcome,
): Promise<PracticeCard> {
  const response = await apiFetch(`${flashCardsUrl}/${id}/practice-results`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ outcome }),
  })
  if (!response.ok) {
    throw new Error('Unable to save your answer.')
  }
  return ((await response.json()) as { next: PracticeCard }).next
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
