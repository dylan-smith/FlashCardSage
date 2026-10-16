import { apiBaseUrl } from '../config'
import { refreshCounts } from '../state/counts'
import { deleteGone, getJson, sendJson, withQuery } from './client'
import type { Tag } from './flashCards'

export const tagNameRequiredMessage = 'Tag name is required.'

// The most a tag name can be, as the API allows.
export const tagMaxLength = 50

const tagsUrl = `${apiBaseUrl}/api/tags`

// The user's tags in name order.
export function listTags() {
  return getJson<Tag[]>(tagsUrl, 'Unable to load tags.')
}

// A tag with no cards yet. Putting a new name on a card makes one too.
export function createTag(name: string) {
  return sendJson<Tag>('POST', tagsUrl, { name }, 'Unable to save tag.')
}

export function renameTag(id: number, name: string) {
  return sendJson<Tag>(
    'PUT',
    `${tagsUrl}/${id}`,
    { name },
    'Unable to rename tag.',
  )
}

// Takes the tag off every card that has it, putting the replacement tag on them instead when there is one, which merges
// the two.
export async function deleteTag(id: number, replaceWith?: number) {
  await deleteGone(
    withQuery(`${tagsUrl}/${id}`, { replaceWith }),
    'Unable to delete tag.',
  )
  refreshCounts()
}
