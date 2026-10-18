import { ApiError, apiFetch, jsonRequest, sendJson } from './client'
import { flashCardsUrl } from './flashCards'
import type { FlashCard } from './flashCards'

// A picture for a card, as base64, which the browser holds until the user puts it on the card: one the API made,
// with its ID in the API's cache of them, or one the user uploaded, without.
export type CardImage = {
  contentType: string
  data: string
  generatedImageId?: number
}

export const picturesUnavailableMessage = "Pictures aren't available."
export const cannotIllustrateMessage =
  "That card can't be illustrated. Try other words."
const generateFailedMessage = 'Unable to make a picture.'

// Asks the API for a picture of what the card means, from whichever sides are filled in. The API keeps every
// picture it makes, so it answers with the first one it has of the words after afterId (the last one the user saw),
// and only makes a new one when there's none left. Throws an ApiError to show as it is when pictures aren't
// available (a 503, e.g. locally, where there's no image generator) or the words can't be illustrated (a 422).
export async function generateCardImage(
  spanish: string,
  english: string,
  afterId?: number,
  signal?: AbortSignal,
): Promise<CardImage & { generatedImageId: number }> {
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
  return { contentType, data, generatedImageId: id }
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

// Puts the picture on the card, replacing any it had, and returns the card with its new picture's URL. A generated
// picture is sent by its ID, since the API has it already, and the card shares it with the cache.
export function putCardImage(id: number, image: CardImage) {
  return sendJson<FlashCard>(
    'PUT',
    `${flashCardsUrl}/${id}/image`,
    image.generatedImageId === undefined
      ? { contentType: image.contentType, data: image.data }
      : { generatedImageId: image.generatedImageId },
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
