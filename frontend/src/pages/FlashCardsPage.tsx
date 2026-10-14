import { useEffect, useRef, useState } from 'react'
import type { ReactNode, Ref, SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useSearchParams } from 'react-router'
import { changeDeckCards, createDeck, listDecks } from '../api/decks'
import type { Deck } from '../api/decks'
import {
  ApiError,
  createFlashCard,
  deleteFlashCard,
  describeFetchError,
  formatWords,
  listFlashCards,
  maxWordsPerSide,
  updateFlashCard,
} from '../api/flashCards'
import type { FlashCard, FlashCardFields, Tag } from '../api/flashCards'
import type { CardSuggestion } from '../api/cardSuggestions'
import { listTags } from '../api/tags'
import type { CardSide, CardText } from '../api/translations'
import { useAutoTranslate } from '../hooks/useAutoTranslate'
import type { AutoTranslate } from '../hooks/useAutoTranslate'
import { useCardPicture } from '../hooks/useCardPicture'
import type { CardPicture } from '../hooks/useCardPicture'
import { usePreferences } from '../hooks/usePreferences'
import { trackEvent, trackException } from '../telemetry'
import { PictureField } from './FlashCardPicture'
import { FlashCardRow } from './FlashCardRow'
import { AddToDeck } from './AddToDeck'
import { CardSuggestions } from './CardSuggestions'
import { cardCount } from './cardCount'
import { deckNameRequiredMessage } from './DecksPage'
import { TagFilter, TagsInput } from './FlashCardTags'

export const spanishRequiredMessage = 'Spanish is required.'
export const englishRequiredMessage = 'English is required.'

// A new card starts with one empty field for each side.
const emptyFields: FlashCardFields = { spanish: [''], english: [''], tags: [] }

// A card being edited, with its tags by name as they're typed in, and the picture it has.
type EditedFlashCard = FlashCardFields & { id: number; imageUrl: string | null }

// A change to a form's fields, made from the fields as they are when it's applied, so a translation that arrives
// late doesn't undo what the user typed in the meantime.
type FieldsUpdate = (fields: FlashCardFields) => FlashCardFields

// A side's words, trimmed, leaving out blanks.
function trimWords(words: string[]) {
  return words.map((word) => word.trim()).filter((word) => word !== '')
}

// Trims the words on both sides of a card, leaving out blank ones, or returns the message for the first side left
// with none. The API tidies up the tags.
function trimFields(fields: FlashCardFields): FlashCardFields | string {
  const spanish = trimWords(fields.spanish)
  const english = trimWords(fields.english)
  if (spanish.length === 0) {
    return spanishRequiredMessage
  }
  if (english.length === 0) {
    return englishRequiredMessage
  }
  return { spanish, english, tags: fields.tags }
}

// The first word on each side, which is the one auto-translation works on.
function firstWords(fields: FlashCardFields): CardText {
  return { spanish: fields.spanish[0] ?? '', english: fields.english[0] ?? '' }
}

// Puts a change to the first words into the fields.
function setFirstWords(change: Partial<CardText>): FieldsUpdate {
  return (fields) => ({
    ...fields,
    spanish:
      change.spanish === undefined
        ? fields.spanish
        : [change.spanish, ...fields.spanish.slice(1)],
    english:
      change.english === undefined
        ? fields.english
        : [change.english, ...fields.english.slice(1)],
  })
}

// A change to one side's words.
type WordsUpdate = (words: string[]) => string[]

function updateWords(side: CardSide, update: WordsUpdate): FieldsUpdate {
  return (fields) =>
    side === 'spanish'
      ? { ...fields, spanish: update(fields.spanish) }
      : { ...fields, english: update(fields.english) }
}

// Each side's words as one line, for a picture of the card.
function pictureWords(fields: FlashCardFields): CardText {
  return {
    spanish: formatWords(trimWords(fields.spanish)),
    english: formatWords(trimWords(fields.english)),
  }
}

// Tags in name order whatever their case, as the API sends them.
function sortTags(tags: Tag[]) {
  return [...tags].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

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
function WordFields({
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
function FlashCardEditForm({
  edit,
  tags,
  picture,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  edit: EditedFlashCard
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

// One card in the list, with Edit and Delete buttons, or, while it's being edited, the form above.
function FlashCardItem({
  card,
  edit,
  tags,
  picture,
  busy,
  picked,
  onPick,
  onEdit,
  onEditChange,
  onEditCancel,
  onEditSave,
  onDelete,
}: {
  card: FlashCard
  edit: EditedFlashCard | null
  tags: Tag[]
  picture: CardPicture
  busy: boolean
  picked: boolean
  onPick: () => void
  onEdit: () => void
  onEditChange: (update: FieldsUpdate) => void
  onEditCancel: () => void
  onEditSave: (event: SubmitEvent<HTMLFormElement>) => void
  onDelete: () => void
}) {
  const spanish = formatWords(card.spanish)

  if (edit !== null) {
    return (
      <FlashCardEditForm
        edit={edit}
        tags={tags}
        picture={picture}
        busy={busy}
        onChange={onEditChange}
        onCancel={onEditCancel}
        onSave={onEditSave}
      />
    )
  }

  return (
    <FlashCardRow
      card={card}
      picked={picked}
      onPick={onPick}
      actions={
        <>
          <Button
            type="button"
            size="small"
            disabled={busy}
            aria-label={`Edit "${spanish}"`}
            onClick={onEdit}
            sx={{ flexShrink: 0 }}
          >
            Edit
          </Button>
          <Button
            type="button"
            size="small"
            color="error"
            disabled={busy}
            aria-label={`Delete "${spanish}"`}
            onClick={onDelete}
            sx={{ flexShrink: 0 }}
          >
            Delete
          </Button>
        </>
      }
    />
  )
}

function FlashCardsPage() {
  const [cards, setCards] = useState<FlashCard[]>([])
  const [fields, setFields] = useState<FlashCardFields>(emptyFields)
  const [loading, setLoading] = useState(true)
  // Set when the list couldn't be loaded, so the page doesn't claim there are no cards.
  const [loadFailed, setLoadFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // The card being edited, as typed so far. One at a time keeps the list simple.
  const [edit, setEdit] = useState<EditedFlashCard | null>(null)
  // The card whose edit is being saved or that is being deleted, so its buttons can wait for the API.
  const [busyId, setBusyId] = useState<number | null>(null)
  // The user's tags in name order, including any no card has any more.
  const [tags, setTags] = useState<Tag[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  // The card last added with the form since a tag was picked, which the suggestions are related to.
  const [addedId, setAddedId] = useState<number | null>(null)
  // The user's decks, to add the picked cards to.
  const [decks, setDecks] = useState<Deck[]>([])
  // The cards picked to add to a deck.
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [deckBusy, setDeckBusy] = useState(false)
  // Says which deck the picked cards went into.
  const [deckNotice, setDeckNotice] = useState<{
    deck: Deck
    count: number
  } | null>(null)
  const translation = useAutoTranslate(firstWords(fields), (change) =>
    setFields(setFirstWords(change)),
  )
  const preferences = usePreferences()
  // The pictures offered by the add form and by the edit form (one card is edited at a time).
  const newPicture = useCardPicture(null)
  const editPicture = useCardPicture(edit?.imageUrl ?? null)

  // The tag whose cards are shown is in the URL, so the back button and a refresh keep it. One that doesn't exist
  // (any more) shows every card.
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTag =
    tags.find((tag) => String(tag.id) === searchParams.get('tag')) ?? null
  const visibleCards =
    selectedTag === null
      ? cards
      : cards.filter((card) =>
          card.tags.some((tag) => tag.id === selectedTag.id),
        )
  const tagCounts = new Map<number, number>()
  for (const tag of cards.flatMap((card) => card.tags)) {
    tagCounts.set(tag.id, (tagCounts.get(tag.id) ?? 0) + 1)
  }
  // Only the picked cards that are shown count, so a card hidden by the tag filter is never added to a deck.
  const pickedIds = visibleCards
    .filter((card) => picked.has(card.id))
    .map((card) => card.id)
  const allPicked =
    visibleCards.length > 0 && pickedIds.length === visibleCards.length
  // Looked up so an edit shows in the suggestions, and once the card is deleted they go back to all the cards.
  const added = cards.find((card) => card.id === addedId)
  // The tag the suggestions go under: the one whose cards are shown, but once a card is added, one of that card's
  // (the shown one if it has it), so they're about the card rather than a tag it isn't under.
  const suggestionTag =
    added === undefined
      ? selectedTag
      : (added.tags.find((tag) => tag.id === selectedTag?.id) ??
        added.tags.at(0) ??
        null)

  // Loads the list and the tags once. The page starts out loading, and the other actions keep both up to date
  // themselves.
  useEffect(() => {
    let cancelled = false
    Promise.all([listFlashCards(), listTags()])
      .then(([loadedCards, loadedTags]) => {
        if (!cancelled) {
          setCards(loadedCards)
          setTags(loadedTags)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trackException(error, { operation: 'load' })
          setLoadFailed(true)
          setErrorMessage(
            describeFetchError(error, 'Unable to load flash cards.'),
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The decks are only needed to add cards to one, so the list still shows if they don't load.
  useEffect(() => {
    let cancelled = false
    listDecks()
      .then((loaded) => {
        if (!cancelled) {
          setDecks(loaded)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trackException(error, { operation: 'loadDecks' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  function togglePicked(id: number) {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) {
        next.add(id)
      }
      return next
    })
  }

  async function handleAddToDeck(deck: Deck) {
    setDeckBusy(true)
    setErrorMessage('')
    setDeckNotice(null)
    try {
      const updated = await changeDeckCards(deck.id, { add: pickedIds })
      trackEvent('DeckCardsAdded')
      setDecks((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      )
      setDeckNotice({ deck: updated, count: pickedIds.length })
      setPicked(new Set())
    } catch (error) {
      trackException(error, { operation: 'addToDeck' })
      setErrorMessage(
        describeFetchError(error, 'Unable to add the cards to the deck.'),
      )
    } finally {
      setDeckBusy(false)
    }
  }

  // Resolves to why the deck wasn't made, or null when it was.
  async function handleCreateDeck(name: string) {
    const trimmed = name.trim()
    if (!trimmed) {
      return deckNameRequiredMessage
    }

    setDeckBusy(true)
    setErrorMessage('')
    setDeckNotice(null)
    try {
      const created = await createDeck({
        name: trimmed,
        flashCardIds: pickedIds,
      })
      trackEvent('DeckCreated')
      setDecks((current) =>
        [...current, created].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        ),
      )
      setDeckNotice({ deck: created, count: pickedIds.length })
      setPicked(new Set())
      return null
    } catch (error) {
      trackException(error, { operation: 'createDeck' })
      return describeFetchError(error, 'Unable to save deck.')
    } finally {
      setDeckBusy(false)
    }
  }

  // A saved card can have tags the API just made for new names, so they're added to the user's tags.
  function addNewTags(card: FlashCard) {
    setTags((current) => {
      const added = card.tags.filter(
        (tag) => !current.some((item) => item.id === tag.id),
      )
      return added.length === 0 ? current : sortTags([...current, ...added])
    })
  }

  // Puts the picture the user chose on a card that's just been saved. The card is saved whatever happens to the
  // picture, so a failure is reported and the card kept as it is.
  async function withPicture(
    picture: CardPicture,
    card: FlashCard,
    failureMessage: string,
  ) {
    try {
      return (await picture.apply(card.id)) ?? card
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'picture' })
      }
      setErrorMessage(describeFetchError(error, failureMessage))
      return card
    }
  }

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    translation.cancel()
    newPicture.cancel()

    const trimmed = trimFields(fields)
    if (typeof trimmed === 'string') {
      setErrorMessage(trimmed)
      return
    }

    setSubmitting(true)
    setErrorMessage('')

    try {
      const created = await createFlashCard(trimmed)
      trackEvent('FlashCardCreated')
      setFields(emptyFields)
      translation.reset()
      const card = await withPicture(
        newPicture,
        created,
        "Flash card saved, but the picture couldn't be added.",
      )
      newPicture.reset()
      setCards((current) => [...current, card])
      setAddedId(card.id)
      addNewTags(card)
    } catch (error) {
      // A rejected card is the user's to fix, not a failure to report.
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'create' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to save flash card.'))
    } finally {
      setSubmitting(false)
    }
  }

  // Adds a suggested card as it is, with the tag the suggestions go under, returning whether it was saved.
  async function handleAddSuggestion(suggestion: CardSuggestion) {
    setErrorMessage('')

    try {
      const created = await createFlashCard({
        spanish: [suggestion.spanish],
        english: [suggestion.english],
        tags: suggestionTag === null ? [] : [suggestionTag.name],
      })
      trackEvent('SuggestedFlashCardAdded')
      setCards((current) => [...current, created])
      return true
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'addSuggestion' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to save flash card.'))
      return false
    }
  }

  async function handleEditSave(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (edit === null) {
      return
    }

    const trimmed = trimFields(edit)
    if (typeof trimmed === 'string') {
      setErrorMessage(trimmed)
      return
    }

    setBusyId(edit.id)
    setErrorMessage('')

    try {
      const updated = await updateFlashCard(edit.id, trimmed)
      trackEvent('FlashCardUpdated')
      const card = await withPicture(
        editPicture,
        updated,
        "Flash card saved, but its picture couldn't be changed.",
      )
      editPicture.reset()
      setCards((current) =>
        current.map((item) => (item.id === card.id ? card : item)),
      )
      addNewTags(card)
      setEdit(null)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'update' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to save flash card.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(card: FlashCard) {
    setBusyId(card.id)
    setErrorMessage('')

    try {
      await deleteFlashCard(card.id)
      trackEvent('FlashCardDeleted')
      setCards((current) => current.filter((item) => item.id !== card.id))
    } catch (error) {
      trackException(error, { operation: 'delete' })
      setErrorMessage(describeFetchError(error, 'Unable to delete flash card.'))
    } finally {
      setBusyId(null)
    }
  }

  function selectTag(tag: Tag | null) {
    setPicked(new Set())
    // The suggestions go back to being about the tag's cards, not a card added before.
    setAddedId(null)
    setSearchParams(tag === null ? {} : { tag: String(tag.id) })
  }

  return (
    <Stack spacing={2}>
      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          Add flash card
        </Typography>
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
          />
          {preferences?.showPictures === true && (
            <PictureField
              picture={newPicture}
              fields={pictureWords(fields)}
              busy={submitting}
            />
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? 'Saving…' : 'Add flash card'}
            </Button>
          </Stack>
        </Box>
      </Paper>

      {/* With a tag in the URL, the suggestions wait for the tags, so they aren't asked for twice. */}
      {preferences?.showSuggestions === true &&
        !(loading && searchParams.has('tag')) && (
          <CardSuggestions
            key={`${added?.id ?? 'all'}-${suggestionTag?.id ?? 'all'}`}
            cards={cards}
            relatedTo={added}
            tag={suggestionTag ?? undefined}
            onAdd={handleAddSuggestion}
          />
        )}

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {deckNotice && (
        <Alert
          severity="success"
          role="status"
          onClose={() => setDeckNotice(null)}
        >
          Added {cardCount(deckNotice.count)} to{' '}
          <Link component={RouterLink} to={`/decks/${deckNotice.deck.id}`}>
            {deckNotice.deck.name}
          </Link>
          .
        </Alert>
      )}

      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          Flash cards
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading" />
          </Box>
        ) : loadFailed ? null : (
          <>
            {tags.length > 0 && (
              <TagFilter
                tags={tags}
                counts={tagCounts}
                total={cards.length}
                selected={selectedTag}
                onSelect={selectTag}
              />
            )}
            {cards.length === 0 ? (
              <Typography color="text.secondary">
                No flash cards yet.
              </Typography>
            ) : visibleCards.length === 0 ? (
              <Typography color="text.secondary">
                No flash cards with this tag.
              </Typography>
            ) : (
              <>
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                  }}
                >
                  <FormControlLabel
                    label={`Pick all ${visibleCards.length}`}
                    control={
                      <Checkbox
                        checked={allPicked}
                        indeterminate={pickedIds.length > 0 && !allPicked}
                        onChange={() =>
                          setPicked(
                            new Set(
                              allPicked
                                ? []
                                : visibleCards.map((card) => card.id),
                            ),
                          )
                        }
                      />
                    }
                  />
                  <AddToDeck
                    decks={decks}
                    count={pickedIds.length}
                    busy={deckBusy}
                    onAdd={(deck) => void handleAddToDeck(deck)}
                    onCreate={handleCreateDeck}
                  />
                </Box>
                <List disablePadding>
                  {visibleCards.map((card) => (
                    <FlashCardItem
                      key={card.id}
                      card={card}
                      edit={edit?.id === card.id ? edit : null}
                      tags={tags}
                      picture={editPicture}
                      busy={busyId === card.id}
                      picked={picked.has(card.id)}
                      onPick={() => togglePicked(card.id)}
                      onEdit={() => {
                        setErrorMessage('')
                        editPicture.reset()
                        setEdit({
                          id: card.id,
                          spanish: card.spanish,
                          english: card.english,
                          tags: card.tags.map((tag) => tag.name),
                          imageUrl: card.imageUrl,
                        })
                      }}
                      onEditChange={(update) =>
                        setEdit((current) =>
                          current === null
                            ? null
                            : { ...current, ...update(current) },
                        )
                      }
                      onEditCancel={() => {
                        setErrorMessage('')
                        editPicture.reset()
                        setEdit(null)
                      }}
                      onEditSave={(event) => void handleEditSave(event)}
                      onDelete={() => void handleDelete(card)}
                    />
                  ))}
                </List>
              </>
            )}
          </>
        )}
      </Paper>
    </Stack>
  )
}

export default FlashCardsPage
