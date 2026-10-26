import { ApiError, apiFetch, jsonRequest, ResponseError } from './client'
import { apiBaseUrl } from '../config'

export const speechUnavailableMessage = "Audio isn't available."
const loadFailedMessage = 'Unable to load the audio.'

// Asks the API for the spoken audio of a card's Spanish words or phrases, and gets a URL to play for each, in order.
// The API keeps every phrase it has read, so a phrase is only read (and paid for) the first time anyone asks. Throws
// an ApiError to show as it is when audio isn't available (a 503, e.g. locally, where there's no speech service).
// With slow, the voice says them more slowly, as a person would for a learner, rather than the audio being stretched.
export async function getSpeechUrls(
  texts: string[],
  slow = false,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await apiFetch(
    `${apiBaseUrl}/api/speech`,
    jsonRequest('POST', { texts, slow }, signal),
  )
  if (response.status === 503) {
    throw new ApiError(503, speechUnavailableMessage)
  }
  if (!response.ok) {
    throw new ResponseError(response.status, loadFailedMessage)
  }
  const { urls } = (await response.json()) as { urls?: unknown }
  if (
    !Array.isArray(urls) ||
    urls.length !== texts.length ||
    !urls.every((url) => typeof url === 'string')
  ) {
    throw new Error(loadFailedMessage)
  }
  return urls
}
