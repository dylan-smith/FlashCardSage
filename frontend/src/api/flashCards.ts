import { apiBaseUrl } from '../config'
import { apiFetch } from './client'

export type FlashCard = {
  id: number
  title: string
}

// The body of a 400 from the API, with the messages for each invalid field.
type ValidationErrorResponse = {
  errors?: Record<string, string[]>
}

// Thrown for a response the caller should show to the user as is, such as a 400 for a blank title.
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
  title: string,
) {
  const response = await apiFetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  })

  // A 400 says what's wrong with the title, so pass that on.
  if (response.status === 400) {
    const error = (await response.json()) as ValidationErrorResponse
    const message = Object.values(error.errors ?? {}).flat()[0]
    throw new ApiError(400, message ?? 'Unable to save flash card.')
  }
  if (!response.ok) {
    throw new Error('Unable to save flash card.')
  }
  return (await response.json()) as FlashCard
}

export function createFlashCard(title: string) {
  return saveFlashCard(flashCardsUrl, 'POST', title)
}

export function updateFlashCard(id: number, title: string) {
  return saveFlashCard(`${flashCardsUrl}/${id}`, 'PUT', title)
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
