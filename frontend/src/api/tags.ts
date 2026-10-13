import { apiBaseUrl } from '../config'
import { apiFetch } from './client'
import { throwIfNotSaved } from './flashCards'
import type { Tag } from './flashCards'

// Tags are made by putting a new name on a card, so there's no call here to create one.
const tagsUrl = `${apiBaseUrl}/api/tags`

// The user's tags in name order.
export async function listTags(): Promise<Tag[]> {
  const response = await apiFetch(tagsUrl)
  if (!response.ok) {
    throw new Error('Unable to load tags.')
  }
  return (await response.json()) as Tag[]
}

export async function renameTag(id: number, name: string) {
  const response = await apiFetch(`${tagsUrl}/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  await throwIfNotSaved(response, 'Unable to rename tag.')
  return (await response.json()) as Tag
}

// Takes the tag off every card that has it. A 404 means the tag is already gone, which is what the caller wanted.
export async function deleteTag(id: number) {
  const response = await apiFetch(`${tagsUrl}/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 404) {
    throw new Error('Unable to delete tag.')
  }
}
