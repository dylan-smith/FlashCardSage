import { useState } from 'react'
import type { SubmitEvent } from 'react'
import {
  ApiError,
  describeFetchError,
  updateFlashCard,
} from '../api/flashCards'
import type { FlashCard, FlashCardFields, Tag } from '../api/flashCards'
import { useCardPicture } from './useCardPicture'
import type { CardPicture } from './useCardPicture'
import { trackEvent, trackException } from '../telemetry'
import { trimFields } from '../lib/cardFields'
import type { FieldsUpdate } from '../lib/cardFields'

// A card being edited, with its tags by name as they're typed in, and the picture it has.
export type EditedFlashCard = FlashCardFields & {
  id: number
  imageUrl: string | null
}

// Tags in name order whatever their case, as the API sends them.
export function sortTags(tags: Tag[]) {
  return [...tags].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

// The user's tags with any a saved card has that they don't, since the API makes tags for new names.
export function withNewTags(tags: Tag[], card: FlashCard) {
  const added = card.tags.filter(
    (tag) => !tags.some((item) => item.id === tag.id),
  )
  return added.length === 0 ? tags : sortTags([...tags, ...added])
}

// Puts the picture the user chose on a card that's just been saved. The card is saved whatever happens to the
// picture, so a failure is reported and the card kept as it is.
export async function withPicture(
  picture: CardPicture,
  card: FlashCard,
  failureMessage: string,
  onError: (message: string) => void,
) {
  try {
    return (await picture.apply(card.id)) ?? card
  } catch (error) {
    if (!(error instanceof ApiError)) {
      trackException(error, { operation: 'picture' })
    }
    onError(describeFetchError(error, failureMessage))
    return card
  }
}

// Editing one card of a list at a time with FlashCardEditForm, as the cards page and a deck's page do. setErrorMessage
// shows why a save failed (and is cleared when an edit starts, stops or is saved), and onSaved gets the saved card.
export function useCardEditor({
  setErrorMessage,
  onSaved,
}: {
  setErrorMessage: (message: string) => void
  onSaved: (card: FlashCard) => void
}) {
  // The card being edited, as typed so far.
  const [edit, setEdit] = useState<EditedFlashCard | null>(null)
  const [saving, setSaving] = useState(false)
  const picture = useCardPicture(edit?.imageUrl ?? null)

  function start(card: FlashCard) {
    setErrorMessage('')
    picture.reset()
    setEdit({
      id: card.id,
      spanish: card.spanish,
      english: card.english,
      tags: card.tags.map((tag) => tag.name),
      imageUrl: card.imageUrl,
    })
  }

  function change(update: FieldsUpdate) {
    setEdit((current) =>
      current === null ? null : { ...current, ...update(current) },
    )
  }

  function cancel() {
    setErrorMessage('')
    picture.reset()
    setEdit(null)
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (edit === null) {
      return
    }

    const trimmed = trimFields(edit)
    if (typeof trimmed === 'string') {
      setErrorMessage(trimmed)
      return
    }

    setSaving(true)
    setErrorMessage('')

    try {
      const updated = await updateFlashCard(edit.id, trimmed)
      trackEvent('FlashCardUpdated')
      const card = await withPicture(
        picture,
        updated,
        "Flash card saved, but its picture couldn't be changed.",
        setErrorMessage,
      )
      picture.reset()
      onSaved(card)
      setEdit(null)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'update' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to save flash card.'))
    } finally {
      setSaving(false)
    }
  }

  return { edit, saving, picture, start, change, cancel, save }
}
