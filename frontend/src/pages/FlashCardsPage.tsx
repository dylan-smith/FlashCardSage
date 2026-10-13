import { useEffect, useRef, useState } from 'react'
import type { ReactNode, SubmitEvent } from 'react'
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
import ListItemText from '@mui/material/ListItemText'
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
  listFlashCards,
  updateFlashCard,
} from '../api/flashCards'
import type { FlashCard, FlashCardFields, Tag } from '../api/flashCards'
import type { CardSuggestion } from '../api/cardSuggestions'
import { listTags } from '../api/tags'
import type { CardSide } from '../api/translations'
import { useAutoTranslate } from '../hooks/useAutoTranslate'
import type { AutoTranslate } from '../hooks/useAutoTranslate'
import { trackEvent, trackException } from '../telemetry'
import { AddToDeck } from './AddToDeck'
import { CardSuggestions } from './CardSuggestions'
import { cardCount } from './cardCount'
import { deckNameRequiredMessage } from './DecksPage'
import { TagFilter, TagsInput } from './FlashCardTags'

export const spanishRequiredMessage = 'Spanish is required.'
export const englishRequiredMessage = 'English is required.'

const emptyFields: FlashCardFields = { spanish: '', english: '', tags: [] }

// A card being edited, with its tags by name as they're typed in.
type EditedFlashCard = FlashCardFields & { id: number }

// Trims both sides of a card, or returns the message for the first one left blank. The API tidies up the tags.
function trimFields(fields: FlashCardFields): FlashCardFields | string {
  const spanish = fields.spanish.trim()
  const english = fields.english.trim()
  if (!spanish) {
    return spanishRequiredMessage
  }
  if (!english) {
    return englishRequiredMessage
  }
  return { spanish, english, tags: fields.tags }
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

// The other side's name, for the button that translates it again.
const otherSideNames: Record<CardSide, string> = {
  spanish: 'English',
  english: 'Spanish',
}

// The note under a side translation fills in: whether it's being translated or was, when a single word has more
// than one meaning, the others to pick from instead, and once the user has put something else in, a button that
// hands it back to translation.
function translationNote(
  translation: AutoTranslate,
  side: CardSide,
  value: string,
): ReactNode {
  const note = translation.helperText(side)
  const others = translation
    .meanings(side)
    .filter((meaning) => meaning !== value)
  const canRetranslate = translation.canRetranslate()
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

// The form that replaces a card in the list while it's being changed. The Spanish field gets focus when the
// form appears, since the user just asked to edit it.
function FlashCardEditForm({
  edit,
  tags,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  edit: EditedFlashCard
  tags: Tag[]
  busy: boolean
  onChange: (change: Partial<FlashCardFields>) => void
  onCancel: () => void
  onSave: (event: SubmitEvent<HTMLFormElement>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const translation = useAutoTranslate(edit, onChange)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <ListItem divider disablePadding sx={{ py: 1 }}>
      <Box
        component="form"
        onSubmit={(event) => {
          translation.cancel()
          onSave(event)
        }}
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          flexGrow: 1,
          gap: 1,
          // Top-aligned, so a field's translation note under it doesn't push it out of line with the other.
          alignItems: { xs: 'stretch', sm: 'flex-start' },
        }}
      >
        <TextField
          label="Spanish"
          value={edit.spanish}
          onChange={(event) =>
            translation.change('spanish', event.target.value)
          }
          helperText={translationNote(translation, 'spanish', edit.spanish)}
          inputRef={inputRef}
          slotProps={fieldSlotProps}
          size="small"
          fullWidth
        />
        <TextField
          label="English"
          value={edit.english}
          onChange={(event) =>
            translation.change('english', event.target.value)
          }
          helperText={translationNote(translation, 'english', edit.english)}
          slotProps={fieldSlotProps}
          size="small"
          fullWidth
        />
        <TagsInput
          value={edit.tags}
          tags={tags}
          onChange={(names) => onChange({ tags: names })}
          size="small"
        />
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, mt: { sm: 0.5 } }}>
          {' '}
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

// One card in the list: a box to pick it, its Spanish and English and its tags with Edit and Delete buttons, or,
// while it's being edited, the form above.
function FlashCardItem({
  card,
  edit,
  tags,
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
  busy: boolean
  picked: boolean
  onPick: () => void
  onEdit: () => void
  onEditChange: (change: Partial<FlashCardFields>) => void
  onEditCancel: () => void
  onEditSave: (event: SubmitEvent<HTMLFormElement>) => void
  onDelete: () => void
}) {
  if (edit !== null) {
    return (
      <FlashCardEditForm
        edit={edit}
        tags={tags}
        busy={busy}
        onChange={onEditChange}
        onCancel={onEditCancel}
        onSave={onEditSave}
      />
    )
  }

  return (
    <ListItem divider disablePadding sx={{ py: 1, gap: 1 }}>
      <Checkbox
        checked={picked}
        onChange={onPick}
        slotProps={{ input: { 'aria-label': `Pick "${card.spanish}"` } }}
        sx={{ flexShrink: 0, alignSelf: 'flex-start', ml: -1.5 }}
      />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <ListItemText
          primary={card.spanish}
          secondary={card.english}
          sx={{ overflowWrap: 'anywhere' }}
        />
        {card.tags.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
            {card.tags.map((tag) => (
              <Chip key={tag.id} label={tag.name} size="small" />
            ))}
          </Box>
        )}
      </Box>
      <Button
        type="button"
        size="small"
        disabled={busy}
        aria-label={`Edit "${card.spanish}"`}
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
        aria-label={`Delete "${card.spanish}"`}
        onClick={onDelete}
        sx={{ flexShrink: 0 }}
      >
        Delete
      </Button>
    </ListItem>
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
  const translation = useAutoTranslate(fields, (change) =>
    setFields((current) => ({ ...current, ...change })),
  )

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

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    translation.cancel()

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
      setCards((current) => [...current, created])
      addNewTags(created)
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

  // Adds a suggested card as it is, returning whether it was saved.
  async function handleAddSuggestion(suggestion: CardSuggestion) {
    setErrorMessage('')

    try {
      const created = await createFlashCard({ ...suggestion, tags: [] })
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
      setCards((current) =>
        current.map((card) => (card.id === updated.id ? updated : card)),
      )
      addNewTags(updated)
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
          <TextField
            id="flash-card-spanish"
            label="Spanish"
            value={fields.spanish}
            onChange={(event) =>
              translation.change('spanish', event.target.value)
            }
            helperText={translationNote(translation, 'spanish', fields.spanish)}
            slotProps={fieldSlotProps}
            required
            placeholder="e.g. el gato"
          />
          <TextField
            id="flash-card-english"
            label="English"
            value={fields.english}
            onChange={(event) =>
              translation.change('english', event.target.value)
            }
            helperText={translationNote(translation, 'english', fields.english)}
            slotProps={fieldSlotProps}
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
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? 'Saving…' : 'Add flash card'}
            </Button>
          </Stack>
        </Box>
      </Paper>

      <CardSuggestions cards={cards} onAdd={handleAddSuggestion} />

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
                      busy={busyId === card.id}
                      picked={picked.has(card.id)}
                      onPick={() => togglePicked(card.id)}
                      onEdit={() => {
                        setErrorMessage('')
                        setEdit({
                          id: card.id,
                          spanish: card.spanish,
                          english: card.english,
                          tags: card.tags.map((tag) => tag.name),
                        })
                      }}
                      onEditChange={(change) =>
                        setEdit((current) =>
                          current === null ? null : { ...current, ...change },
                        )
                      }
                      onEditCancel={() => {
                        setErrorMessage('')
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
