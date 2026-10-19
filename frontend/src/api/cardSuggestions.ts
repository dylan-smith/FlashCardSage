import { apiBaseUrl } from '../config'
import { getJson, optional, withQuery } from './client'

// A card the user doesn't have yet, suggested from the ones they do.
export type CardSuggestion = {
  spanish: string
  english: string
}

// A handful of new cards that go with the user's cards, related to the card with the ID relatedTo and under the tag with
// the ID tag when they're given, and none whose Spanish is in exclude (already shown), or null when suggestions aren't
// available (a 503, e.g. locally, where there's no Foundry endpoint and key). Without exclude, the API gives the ones it
// last gave while the user's cards haven't changed, and with it, it asks for new ones. Throws when they fail.
export function listCardSuggestions(
  {
    relatedTo,
    tag,
    exclude,
  }: { relatedTo?: number; tag?: number; exclude?: string[] },
  signal?: AbortSignal,
) {
  return optional(
    getJson<CardSuggestion[]>(
      withQuery(`${apiBaseUrl}/api/card-suggestions`, {
        relatedTo,
        tag,
        exclude,
      }),
      'Unable to suggest cards.',
      { signal },
    ),
  )
}
