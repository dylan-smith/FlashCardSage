import { useEffect, useRef } from 'react'
import type { ReactNode, Ref, SubmitEvent } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import ListItem from '@mui/material/ListItem'
import TextField from '@mui/material/TextField'
import { maxWordsPerSide } from '../api/flashCards'
import type { FlashCardFields, Tag } from '../api/flashCards'
import type { CardSide } from '../api/translations'
import { useAutoTranslate } from '../hooks/useAutoTranslate'
import type { AutoTranslate } from '../hooks/useAutoTranslate'
import type { CardPicture } from '../hooks/useCardPicture'
import { usePreferences } from '../hooks/usePreferences'
import { useTagSuggestions } from '../hooks/useTagSuggestions'
import {
  firstWords,
  pictureWords,
  setFirstWords,
  updateWords,
} from './cardFields'
import type { FieldsUpdate, WordsUpdate } from './cardFields'
import { PictureField } from './FlashCardPicture'
import { TagsInput } from './FlashCardTags'

// The fields of a card's form, shared by the cards page and the cards scanned from a document: each side's words (with
// translation as the user types), the card's tags and its picture.

// A side's input is limited like the API's, and its note is a div, since it can hold the meanings' chips.
const fieldSlotProps = {
  htmlInput: { maxLength: 200 },
  formHelperText: { component: 'div' },
} as const

const sideNames: Record<CardSide, string> = {
  spanish: 'Spanish',
  english: 'English',
}

// The other side's name, for the button that translates it again.
const otherSideNames: Record<CardSide, string> = {
  spanish: 'English',
  english: 'Spanish',
}

// The note under a side translation fills in: whether it's being translated or was, when a single word has more
// than one meaning, the others to pick from instead, and once the user has put something else in or emptied it, a
// button that hands it back to translation.
function translationNote(
  translation: AutoTranslate,
  side: CardSide,
  value: string,
): ReactNode {
  const note = translation.helperText(side)
  const others = translation
    .meanings(side)
    .filter((meaning) => meaning !== value)
  const canRetranslate = translation.canRetranslate(side)
  if (others.length === 0 && !canRetranslate) {
    return note
  }
  return (
    <>
      {note}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 0.5,
          mt: note ? 0.5 : 0,
        }}
      >
        {others.length > 0 && 'Other meanings:'}
        {others.map((meaning) => (
          <Chip
            key={meaning}
            label={meaning}
            size="small"
            variant="outlined"
            onClick={() => translation.choose(side, meaning)}
          />
        ))}
        {canRetranslate && (
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() => translation.retranslate(side)}
            sx={{ py: 0.25 }}
          >
            Translate from {otherSideNames[side]}
          </Button>
        )}
      </Box>
    </>
  )
}

// A side's words, one field each, for a card with more than one word for the same meaning (e.g. "solo" and
// "únicamente" for "only"). The first is filled in by translation, and the others are the user's to type, add and
// remove. A new field gets focus, since the user just asked for it.
export function WordFields({
  side,
  words,
  translation,
  onChange,
  id,
  inputRef,
  required,
  placeholder,
  size,
}: {
  side: CardSide
  words: string[]
  translation: AutoTranslate
  onChange: (update: WordsUpdate) => void
  id?: string
  inputRef?: Ref<HTMLInputElement>
  required?: boolean
  placeholder?: string
  size?: 'small'
}) {
  const name = sideNames[side]
  const lastRef = useRef<HTMLInputElement>(null)
  const added = useRef(false)

  useEffect(() => {
    if (added.current) {
      added.current = false
      lastRef.current?.focus()
    }
  }, [words.length])

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
      }}
    >
      {words.map((word, index) =>
        index === 0 ? (
          <TextField
            key={index}
            id={id}
            label={name}
            value={word}
            onChange={(event) => translation.change(side, event.target.value)}
            helperText={translationNote(translation, side, word)}
            inputRef={inputRef}
            slotProps={fieldSlotProps}
            required={required}
            placeholder={placeholder}
            size={size}
            fullWidth
          />
        ) : (
          <Box
            key={index}
            sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}
          >
            <TextField
              label={`${name} ${index + 1}`}
              value={word}
              onChange={(event) => {
                const value = event.target.value
                onChange((current) =>
                  current.map((item, position) =>
                    position === index ? value : item,
                  ),
                )
              }}
              inputRef={index === words.length - 1 ? lastRef : undefined}
              slotProps={fieldSlotProps}
              size={size}
              fullWidth
            />
            <Button
              type="button"
              size="small"
              aria-label={`Remove ${name} ${index + 1}`}
              onClick={() =>
                onChange((current) =>
                  current.filter((_, position) => position !== index),
                )
              }
              sx={{ flexShrink: 0, mt: size === 'small' ? 0.5 : 1 }}
            >
              Remove
            </Button>
          </Box>
        ),
      )}
      {words.length < maxWordsPerSide && (
        <Button
          type="button"
          size="small"
          onClick={() => {
            added.current = true
            onChange((current) => [...current, ''])
          }}
          sx={{ alignSelf: 'flex-start' }}
        >
          Add {name} translation
        </Button>
      )}
    </Box>
  )
}

// The form that replaces a card in the list while it's being changed. The Spanish field gets focus when the
// form appears, since the user just asked to edit it.
export function FlashCardEditForm({
  edit,
  tags,
  picture,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  edit: FlashCardFields
  tags: Tag[]
  picture: CardPicture
  busy: boolean
  onChange: (update: FieldsUpdate) => void
  onCancel: () => void
  onSave: (event: SubmitEvent<HTMLFormElement>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const translation = useAutoTranslate(firstWords(edit), (change) =>
    onChange(setFirstWords(change)),
  )
  const showPictures = usePreferences()?.showPictures === true
  const suggestedTags = useTagSuggestions(edit, tags)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <ListItem divider disablePadding sx={{ py: 1 }}>
      <Box
        component="form"
        onSubmit={(event) => {
          translation.cancel()
          picture.cancel()
          onSave(event)
        }}
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          // The picture goes on a row of its own under the fields, and Save and Cancel under it.
          flexWrap: 'wrap',
          flexGrow: 1,
          gap: 1,
          // Top-aligned, so a field's translation note under it doesn't push it out of line with the other.
          alignItems: { xs: 'stretch', sm: 'flex-start' },
        }}
      >
        <WordFields
          side="spanish"
          words={edit.spanish}
          translation={translation}
          onChange={(update) => onChange(updateWords('spanish', update))}
          inputRef={inputRef}
          size="small"
        />
        <WordFields
          side="english"
          words={edit.english}
          translation={translation}
          onChange={(update) => onChange(updateWords('english', update))}
          size="small"
        />
        <TagsInput
          value={edit.tags}
          tags={tags}
          onChange={(names) =>
            onChange((current) => ({ ...current, tags: names }))
          }
          suggestions={suggestedTags}
          size="small"
        />
        {showPictures && (
          <Box sx={{ flexBasis: '100%' }}>
            <PictureField
              picture={picture}
              fields={pictureWords(edit)}
              busy={busy}
              size="small"
            />
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
          <Button
            type="submit"
            variant="contained"
            size="small"
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" size="small" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </Box>
      </Box>
    </ListItem>
  )
}
