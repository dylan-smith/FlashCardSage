import { apiBaseUrl } from '../config'
import { apiFetch } from './client'
import { throwIfNotSaved } from './flashCards'
import type { Tag } from './flashCards'

const tagsUrl = `${apiBaseUrl}/api/tags`

// The user's tags in name order.
export async function listTags(): Promise<Tag[]> {
  const response = await apiFetch(tagsUrl)
  if (!response.ok) {
    throw new Error('Unable to load tags.')
  }
  return (await response.json()) as Tag[]
}

// A tag with no cards yet. Putting a new name on a card makes one too.
export async function createTag(name: string) {
  const response = await apiFetch(tagsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  await throwIfNotSaved(response, 'Unable to save tag.')
  return (await response.json()) as Tag
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
