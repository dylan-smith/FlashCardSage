import { apiBaseUrl } from '../config'
import { getJson, jsonRequest, optional, withQuery } from './client'
import type { FlashCardFields, Tag } from './flashCards'

// The user's tags a card with these fields goes under, leaving out the ones it has, or null when suggestions aren't
// available (a 503, e.g. locally, where there's no Foundry endpoint and key). Empty when no tag fits. Throws when they
// fail.
export function suggestTags(fields: FlashCardFields, signal?: AbortSignal) {
  return optional(
    getJson<Tag[]>(
      `${apiBaseUrl}/api/tag-suggestions`,
      'Unable to suggest tags.',
      jsonRequest('POST', fields, signal),
    ),
  )
}

// The names of a handful of new tags that go with the user's tags and cards, or null when suggestions aren't available
// (a 503). The API gives the same ones as last time while the user's tags and cards haven't changed, unless refresh
// asks for new ones. Throws when they fail.
export function listNewTagSuggestions(
  { refresh }: { refresh?: boolean },
  signal?: AbortSignal,
) {
  return optional(
    getJson<string[]>(
      withQuery(`${apiBaseUrl}/api/tag-suggestions/new`, {
        refresh: refresh === true ? 'true' : undefined,
      }),
      'Unable to suggest tags.',
      { signal },
    ),
  )
}
