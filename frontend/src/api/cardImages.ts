import { ApiError, apiFetch, jsonRequest, sendJson } from './client'
import { flashCardsUrl } from './flashCards'
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

// A generated picture, and its ID in the API's cache of them, which asks for the next picture of the same words.
export type GeneratedCardImage = {
  id: number
  image: CardImage
}

// Asks the API for a picture of what the card means, from whichever sides are filled in. The API keeps every
// picture it makes, so it answers with the first one it has of the words after afterId (the last one the user saw),
// and only makes a new one when there's none left. Throws an ApiError to show as it is when pictures aren't
// available (a 503, e.g. locally, where there's no image generator) or the words can't be illustrated (a 422).
export async function generateCardImage(
  spanish: string,
  english: string,
  afterId?: number,
  signal?: AbortSignal,
): Promise<GeneratedCardImage> {
  const response = await apiFetch(
    `${flashCardsUrl}/images/generate`,
    jsonRequest('POST', { spanish, english, afterId }, signal),
  )
  if (response.status === 503) {
    throw new ApiError(503, picturesUnavailableMessage)
  }
  if (response.status === 422) {
    throw new ApiError(422, cannotIllustrateMessage)
  }
  if (!response.ok) {
    throw new Error(generateFailedMessage)
  }
  const { id, contentType, data } = (await response.json()) as {
    id?: unknown
    contentType?: unknown
    data?: unknown
  }
  if (
    typeof id !== 'number' ||
    typeof contentType !== 'string' ||
    typeof data !== 'string'
  ) {
    throw new Error(generateFailedMessage)
  }
  return { id, image: { contentType, data } }
}

// The kinds of picture the API keeps, and the biggest it takes (CardImage.cs), so a file it would refuse is turned
// away before it's sent.
export const cardImageTypes = ['image/jpeg', 'image/png', 'image/webp']
export const maxCardImageBytes = 5 * 1024 * 1024
export const wrongImageTypeMessage = 'The picture must be a JPEG, PNG or WebP.'
export const imageTooBigMessage = 'The picture can be at most 5 MB.'

// Reads a picture the user picked from their device. Throws an Error to show as it is when the API wouldn't take it.
export async function readCardImageFile(file: File): Promise<CardImage> {
  if (!cardImageTypes.includes(file.type)) {
    throw new Error(wrongImageTypeMessage)
  }
  if (file.size > maxCardImageBytes) {
    throw new Error(imageTooBigMessage)
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Unable to read the picture.'))
    reader.readAsDataURL(file)
  })
  return {
    contentType: file.type,
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
  }
}

// The picture as a URL an img can show before it's on the card.
export function cardImageDataUrl(image: CardImage) {
  return `data:${image.contentType};base64,${image.data}`
}

// Puts the picture on the card, replacing any it had, and returns the card with its new picture's URL.
export function putCardImage(id: number, image: CardImage) {
  return sendJson<FlashCard>(
    'PUT',
    `${flashCardsUrl}/${id}/image`,
    image,
    'Unable to add the picture.',
  )
}

// Takes the card's picture off, and returns the card without it.
export function deleteCardImage(id: number) {
  return sendJson<FlashCard>(
    'DELETE',
    `${flashCardsUrl}/${id}/image`,
    undefined,
    'Unable to remove the picture.',
  )
}
