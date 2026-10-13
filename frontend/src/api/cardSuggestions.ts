import { apiBaseUrl } from '../config'
import { apiFetch } from './client'

// A card the user doesn't have yet, suggested from the ones they do.
export type CardSuggestion = {
  spanish: string
  english: string
}

// A handful of new cards that go with the user's cards, related to the card with the ID relatedTo when it's given, or
// null when suggestions aren't available (a 503, e.g. locally, where there's no Foundry endpoint and key). Throws when
// they fail.
export async function listCardSuggestions(
  relatedTo?: number,
  signal?: AbortSignal,
): Promise<CardSuggestion[] | null> {
  const query = relatedTo === undefined ? '' : `?relatedTo=${relatedTo}`
  const response = await apiFetch(
    `${apiBaseUrl}/api/card-suggestions${query}`,
    { signal },
  )
  if (response.status === 503) {
    return null
  }
  if (!response.ok) {
    throw new Error('Unable to suggest cards.')
  }
  return (await response.json()) as CardSuggestion[]
}
