import { apiBaseUrl } from '../config'
import { apiFetch } from './client'
import { ApiError, throwIfNotSaved } from './flashCards'
import type { FlashCard } from './flashCards'

// A picture the API made for a card, as base64. The browser holds it until the user puts it on the card, so one
// they don't want is never kept.
export type CardImage = {
  contentType: string
  data: string
}

export const picturesUnavailableMessage = "Pictures aren't available."
export const cannotIllustrateMessage =
  "That card can't be illustrated. Try other words."
const generateFailedMessage = 'Unable to make a picture.'

const flashCardsUrl = `${apiBaseUrl}/api/flashcards`

const jsonHeaders = { 'Content-Type': 'application/json' }

// Asks the API for a picture of what the card means, from whichever sides are filled in. Throws an ApiError to
// show as it is when pictures aren't available (a 503, e.g. locally, where there's no image generator) or the
// words can't be illustrated (a 422).
export async function generateCardImage(
  spanish: string,
  english: string,
  signal?: AbortSignal,
): Promise<CardImage> {
  const response = await apiFetch(`${flashCardsUrl}/images/generate`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ spanish, english }),
    signal,
  })
  if (response.status === 503) {
    throw new ApiError(503, picturesUnavailableMessage)
  }
  if (response.status === 422) {
    throw new ApiError(422, cannotIllustrateMessage)
  }
  if (!response.ok) {
    throw new Error(generateFailedMessage)
  }
  const { contentType, data } = (await response.json()) as {
    contentType?: unknown
    data?: unknown
  }
  if (typeof contentType !== 'string' || typeof data !== 'string') {
    throw new Error(generateFailedMessage)
  }
  return { contentType, data }
}

// The picture as a URL an img can show before it's on the card.
export function cardImageDataUrl(image: CardImage) {
  return `data:${image.contentType};base64,${image.data}`
}

// Puts the picture on the card, replacing any it had, and returns the card with its new picture's URL.
export async function putCardImage(
  id: number,
  image: CardImage,
): Promise<FlashCard> {
  const response = await apiFetch(`${flashCardsUrl}/${id}/image`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(image),
  })
  await throwIfNotSaved(response, 'Unable to add the picture.')
  return (await response.json()) as FlashCard
}

// Takes the card's picture off, and returns the card without it.
export async function deleteCardImage(id: number): Promise<FlashCard> {
  const response = await apiFetch(`${flashCardsUrl}/${id}/image`, {
    method: 'DELETE',
  })
  await throwIfNotSaved(response, 'Unable to remove the picture.')
  return (await response.json()) as FlashCard
}
