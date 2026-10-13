import { apiBaseUrl } from '../config'
import { apiFetch } from './client'

// A card the user doesn't have yet, suggested from the ones they do.
export type CardSuggestion = {
  spanish: string
  english: string
}

// A handful of new cards that go with the user's cards, related to the card with the ID relatedTo and under the tag with
// the ID tag when they're given, or null when suggestions aren't available (a 503, e.g. locally, where there's no Foundry
// endpoint and key). Throws when they fail.
export async function listCardSuggestions(
  { relatedTo, tag }: { relatedTo?: number; tag?: number },
  signal?: AbortSignal,
): Promise<CardSuggestion[] | null> {
  const params = new URLSearchParams()
  if (relatedTo !== undefined) {
    params.set('relatedTo', String(relatedTo))
  }
  if (tag !== undefined) {
    params.set('tag', String(tag))
  }
  const query = params.toString()
  const response = await apiFetch(
    `${apiBaseUrl}/api/card-suggestions${query ? `?${query}` : ''}`,
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
