import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { cardImageDataUrl } from '../api/cardImages'
import type { CardImage } from '../api/cardImages'
import type { FlashCard, FlashCardFields } from '../api/flashCards'
import { useCardPicture } from '../hooks/useCardPicture'
import { trimFields } from './cardFields'
import type { FieldsUpdate } from './cardFields'

// A card to add, such as one made from a document, a Preply word or a suggestion, with a key of its own, since the
// user can change it like any card: its words, its tags and a picture. The picture is kept here until the card is
// added, and then put on it.
export type Candidate = FlashCardFields & {
  key: number
  picture: CardImage | null
}

// The candidate being changed, as typed so far.
type Editing = FlashCardFields & { key: number }

// A candidate as a card, so it's shown like the user's cards are, with its picture if it has one.
export function asCard(candidate: Candidate): FlashCard {
  return {
    id: candidate.key,
    spanish: candidate.spanish,
    english: candidate.english,
    tags: candidate.tags.map((name, id) => ({ id, name })),
    imageUrl:
      candidate.picture === null ? null : cardImageDataUrl(candidate.picture),
  }
}

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
    const { generated, current } = editPicture
    onCandidatesChange((all) =>
      all.map((candidate) =>
        candidate.key === editing.key
          ? {
              ...candidate,
              ...trimmed,
              picture:
                generated ?? (current === null ? null : candidate.picture),
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
