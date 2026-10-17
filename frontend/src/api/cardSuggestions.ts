import { apiBaseUrl } from '../config'
import { getJson, optional, withQuery } from './client'

// A card the user doesn't have yet, suggested from the ones they do.
export type CardSuggestion = {
  spanish: string
  english: string
}

// A handful of new cards that go with the user's cards, related to the card with the ID relatedTo and under the tag with
// the ID tag when they're given, or null when suggestions aren't available (a 503, e.g. locally, where there's no Foundry
// endpoint and key). Throws when they fail.
export function listCardSuggestions(
  { relatedTo, tag }: { relatedTo?: number; tag?: number },
  signal?: AbortSignal,
) {
  return optional(
    getJson<CardSuggestion[]>(
      withQuery(`${apiBaseUrl}/api/card-suggestions`, { relatedTo, tag }),
      'Unable to suggest cards.',
      { signal },
    ),
  )
}
