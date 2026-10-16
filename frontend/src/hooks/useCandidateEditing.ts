import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { cardImageDataUrl } from '../api/cardImages'
import type { FlashCardFields } from '../api/flashCards'
import { trimFields } from '../lib/cardFields'
import type { FieldsUpdate } from '../lib/cardFields'
import type { Candidate } from '../lib/candidates'
import { useCardPicture } from './useCardPicture'

// The candidate being changed, as typed so far.
type Editing = FlashCardFields & { key: number }

// Changing a candidate with the same form as the cards page, one at a time. Saving keeps the changes on the
// candidate, including the picture the user asked for or took off, until it's added. Anything wrong with them, such
// as a side left empty, goes to onError.
export function useCandidateEditing(
  candidates: Candidate[],
  onCandidatesChange: (
    update: (candidates: Candidate[]) => Candidate[],
  ) => void,
  onError: (message: string) => void,
) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const editingCandidate =
    editing === null
      ? undefined
      : candidates.find((candidate) => candidate.key === editing.key)
  // The picture the edit form offers: the one the candidate has, if any, or one the user asks for.
  const editPicture = useCardPicture(
    editingCandidate?.picture
      ? cardImageDataUrl(editingCandidate.picture)
      : null,
  )

  function startEditing(candidate: Candidate) {
    onError('')
    editPicture.reset()
    setEditing({
      key: candidate.key,
      spanish: candidate.spanish,
      english: candidate.english,
      tags: candidate.tags,
    })
  }

  function stopEditing() {
    editPicture.reset()
    setEditing(null)
  }

  function changeEdit(update: FieldsUpdate) {
    setEditing((current) =>
      current === null ? null : { ...current, ...update(current) },
    )
  }

  function cancelEdit() {
    onError('')
    stopEditing()
  }

  function saveEdit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editing === null) {
      return
    }
    const trimmed = trimFields(editing)
    if (typeof trimmed === 'string') {
      onError(trimmed)
      return
    }
    onError('')
    const { chosen, current } = editPicture
    onCandidatesChange((all) =>
      all.map((candidate) =>
        candidate.key === editing.key
          ? {
              ...candidate,
              ...trimmed,
              picture: chosen ?? (current === null ? null : candidate.picture),
            }
          : candidate,
      ),
    )
    stopEditing()
  }

  return {
    editing,
    editPicture,
    startEditing,
    changeEdit,
    cancelEdit,
    saveEdit,
  }
}
