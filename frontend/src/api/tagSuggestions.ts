import { apiBaseUrl } from '../config'
import { apiFetch } from './client'
import type { FlashCardFields, Tag } from './flashCards'

// The user's tags a card with these fields goes under, leaving out the ones it has, or null when suggestions aren't
// available (a 503, e.g. locally, where there's no Foundry endpoint and key). Empty when no tag fits. Throws when they
// fail.
export async function suggestTags(
  fields: FlashCardFields,
  signal?: AbortSignal,
): Promise<Tag[] | null> {
  const response = await apiFetch(`${apiBaseUrl}/api/tag-suggestions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fields),
    signal,
  })
  if (response.status === 503) {
    return null
  }
  if (!response.ok) {
    throw new Error('Unable to suggest tags.')
  }
  return (await response.json()) as Tag[]
}
