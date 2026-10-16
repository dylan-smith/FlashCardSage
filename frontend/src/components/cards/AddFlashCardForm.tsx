import { useState } from 'react'
import type { SubmitEvent } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import { createFlashCard } from '../../api/flashCards'
import type { FlashCard, FlashCardFields, Tag } from '../../api/flashCards'
import { useAction } from '../../hooks/useAction'
import { useAutoTranslate } from '../../hooks/useAutoTranslate'
import { withPicture } from '../../hooks/useCardEditor'
import { useCardPicture } from '../../hooks/useCardPicture'
import { usePreferences } from '../../hooks/usePreferences'
import { useTagSuggestions } from '../../hooks/useTagSuggestions'
import {
  firstWords,
  pictureWords,
  setFirstWords,
  trimFields,
  updateWords,
} from '../../lib/cardFields'
import { trackEvent } from '../../telemetry'
import { PictureField } from './FlashCardPicture'
import { WordFields } from './FlashCardForm'
import { TagsInput } from './FlashCardTags'

// A new card starts with one empty field for each side.
const emptyFields: FlashCardFields = { spanish: [''], english: [''], tags: [] }

// The cards page's form for a new card: its words, translated as they're typed, its tags, with suggestions, and a
// picture when the user has pictures turned on. onCreated gets the saved card, and setErrorMessage shows why it
// wasn't saved.
export function AddFlashCardForm({
  tags,
  setErrorMessage,
  onCreated,
}: {
  // The user's tags, which the tags field offers.
  tags: Tag[]
  setErrorMessage: (message: string) => void
  onCreated: (card: FlashCard) => void
}) {
  const [fields, setFields] = useState<FlashCardFields>(emptyFields)
  const creating = useAction(setErrorMessage)
  const translation = useAutoTranslate(firstWords(fields), (change) =>
    setFields(setFirstWords(change)),
  )
  const preferences = usePreferences()
  const suggestedTags = useTagSuggestions(fields, tags)
  // The picture offered by the form.
  const newPicture = useCardPicture(null)

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    translation.cancel()
    newPicture.cancel()

    const trimmed = trimFields(fields)
    if (typeof trimmed === 'string') {
      setErrorMessage(trimmed)
      return
    }

    await creating.run(
      { operation: 'create', fallback: 'Unable to save flash card.' },
      async () => {
        const created = await createFlashCard(trimmed)
        trackEvent('FlashCardCreated')
        setFields(emptyFields)
        translation.reset()
        const card = await withPicture(
          newPicture,
          created,
          "Flash card saved, but the picture couldn't be added.",
          setErrorMessage,
        )
        newPicture.reset()
        onCreated(card)
      },
    )
  }

  return (
    <Box
      component="form"
      onSubmit={(event) => void handleCreate(event)}
      sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <WordFields
        side="spanish"
        words={fields.spanish}
        translation={translation}
        onChange={(update) => setFields(updateWords('spanish', update))}
        id="flash-card-spanish"
        required
        placeholder="e.g. el gato"
      />
      <WordFields
        side="english"
        words={fields.english}
        translation={translation}
        onChange={(update) => setFields(updateWords('english', update))}
        id="flash-card-english"
        required
        placeholder="e.g. the cat"
      />
      <TagsInput
        value={fields.tags}
        tags={tags}
        onChange={(names) =>
          setFields((current) => ({ ...current, tags: names }))
        }
        suggestions={suggestedTags.names}
        suggesting={suggestedTags.loading}
      />
      {preferences?.showPictures === true && (
        <PictureField
          picture={newPicture}
          fields={pictureWords(fields)}
          busy={creating.busy}
        />
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button type="submit" variant="contained" disabled={creating.busy}>
          {creating.busy ? 'Saving…' : 'Add flash card'}
        </Button>
      </Stack>
    </Box>
  )
}
