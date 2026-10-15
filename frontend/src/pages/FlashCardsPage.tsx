import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import List from '@mui/material/List'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useSearchParams } from 'react-router'
import { changeDeckCards, createDeck, listDecks } from '../api/decks'
import type { Deck } from '../api/decks'
import {
  ApiError,
  createFlashCard,
  deleteFlashCard,
  deleteFlashCards,
  describeFetchError,
  formatWords,
  listFlashCards,
} from '../api/flashCards'
import type { FlashCard, FlashCardFields, Tag } from '../api/flashCards'
import { putCardImage } from '../api/cardImages'
import { listTags } from '../api/tags'
import { useAutoTranslate } from '../hooks/useAutoTranslate'
import { useCardPicture } from '../hooks/useCardPicture'
import type { CardPicture } from '../hooks/useCardPicture'
import { usePreferences } from '../hooks/usePreferences'
import { useTagSuggestions } from '../hooks/useTagSuggestions'
import { CardActionButton } from './CardActionButton'
import { trackEvent, trackException } from '../telemetry'
import { showToast } from '../toasts'
import { PictureField } from './FlashCardPicture'
import { FlashCardRow } from './FlashCardRow'
import { AddToDeck } from './AddToDeck'
import type { Candidate } from './candidates'
import { CardSuggestions } from './CardSuggestions'
import { ConfirmDelete } from './ConfirmDelete'
import { cardDeleteWarning } from './cardDeleteWarning'
import { DeleteCards } from './DeleteCards'
import { cardCount } from './cardCount'
import { deckNameRequiredMessage } from './DecksPage'
import {
  firstWords,
  pictureWords,
  setFirstWords,
  trimFields,
  updateWords,
} from './cardFields'
import type { FieldsUpdate } from './cardFields'
import { FlashCardEditForm, WordFields } from './FlashCardForm'
import { TagFilter, TagsInput } from './FlashCardTags'
import { useCardEditor, withNewTags, withPicture } from './useCardEditor'
import type { EditedFlashCard } from './useCardEditor'

// The toast for what was just done to the picked cards, so a new one replaces the last.
const cardsPageToast = 'picked-cards'

// A new card starts with one empty field for each side.
const emptyFields: FlashCardFields = { spanish: [''], english: [''], tags: [] }

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
          <CardActionButton
            icon="edit"
            text="Edit"
            label={`Edit "${spanish}"`}
            disabled={busy}
            onClick={onEdit}
          />
          <CardActionButton
            icon="delete"
            text="Delete"
            label={`Delete "${spanish}"`}
            disabled={busy}
            onClick={onDelete}
          />
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
  // The card being deleted, so its buttons can wait for the API.
  const [busyId, setBusyId] = useState<number | null>(null)
  // The user's tags in name order, including any no card has any more.
  const [tags, setTags] = useState<Tag[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  // The card last added with the form since a tag was picked, which the suggestions are related to.
  const [addedId, setAddedId] = useState<number | null>(null)
  // The user's decks, to add the picked cards to.
  const [decks, setDecks] = useState<Deck[]>([])
  // The cards picked to add to a deck or delete.
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [deckBusy, setDeckBusy] = useState(false)
  const [deletingPicked, setDeletingPicked] = useState(false)
  // The card whose Delete was clicked, while the user is asked whether they mean it.
  const [confirmingDelete, setConfirmingDelete] = useState<FlashCard | null>(
    null,
  )
  const translation = useAutoTranslate(firstWords(fields), (change) =>
    setFields(setFirstWords(change)),
  )
  const preferences = usePreferences()
  const suggestedTags = useTagSuggestions(fields, tags)
  // The picture offered by the add form.
  const newPicture = useCardPicture(null)
  // The card being edited. One at a time keeps the list simple.
  const editor = useCardEditor({
    setErrorMessage,
    onSaved: (card) => {
      setCards((current) =>
        current.map((item) => (item.id === card.id ? card : item)),
      )
      addNewTags(card)
    },
  })

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
  // Only the picked cards that are shown count, so a card hidden by the tag filter is never added to a deck or
  // deleted.
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

  // Says which deck the picked cards went into, with a link to it.
  function showDeckNotice(deck: Deck, count: number) {
    showToast({
      key: cardsPageToast,
      severity: 'success',
      message: (
        <>
          Added {cardCount(count)} to{' '}
          <Link component={RouterLink} to={`/decks/${deck.id}`} color="inherit">
            {deck.name}
          </Link>
          .
        </>
      ),
    })
  }

  async function handleAddToDeck(deck: Deck) {
    setDeckBusy(true)
    setErrorMessage('')
    try {
      const updated = await changeDeckCards(deck.id, { add: pickedIds })
      trackEvent('DeckCardsAdded')
      setDecks((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      )
      showDeckNotice(updated, pickedIds.length)
      setPicked(new Set())
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'addToDeck' })
      }
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
      showDeckNotice(created, pickedIds.length)
      setPicked(new Set())
      return null
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'createDeck' })
      }
      return describeFetchError(error, 'Unable to save deck.')
    } finally {
      setDeckBusy(false)
    }
  }

  // A saved card can have tags the API just made for new names, so they're added to the user's tags.
  function addNewTags(card: FlashCard) {
    setTags((current) => withNewTags(current, card))
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
        setErrorMessage,
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

  // Adds a suggested card, with any changes the user made to it, returning whether it was saved. The card is saved
  // whatever happens to its picture, so a failure there is reported and the card kept without it.
  async function handleAddSuggestion({
    spanish,
    english,
    tags: tagNames,
    picture,
  }: Candidate) {
    setErrorMessage('')

    try {
      let card = await createFlashCard({ spanish, english, tags: tagNames })
      trackEvent('SuggestedFlashCardAdded')
      if (picture !== null) {
        try {
          card = await putCardImage(card.id, picture)
          trackEvent('FlashCardImageAdded')
        } catch (error) {
          if (!(error instanceof ApiError)) {
            trackException(error, { operation: 'picture' })
          }
          setErrorMessage(
            describeFetchError(
              error,
              "Flash card saved, but the picture couldn't be added.",
            ),
          )
        }
      }
      setCards((current) => [...current, card])
      addNewTags(card)
      return true
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'addSuggestion' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to save flash card.'))
      return false
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
      setConfirmingDelete(null)
    }
  }

  async function handleDeletePicked() {
    const ids = new Set(pickedIds)
    setDeletingPicked(true)
    setErrorMessage('')

    try {
      await deleteFlashCards([...ids])
      trackEvent('FlashCardsDeleted')
      setCards((current) => current.filter((item) => !ids.has(item.id)))
      if (editor.edit !== null && ids.has(editor.edit.id)) {
        editor.cancel()
      }
      showToast({
        key: cardsPageToast,
        severity: 'success',
        message: `Deleted ${cardCount(ids.size)}.`,
      })
      setPicked(new Set())
    } catch (error) {
      trackException(error, { operation: 'deleteMany' })
      setErrorMessage(
        describeFetchError(error, 'Unable to delete the flash cards.'),
      )
    } finally {
      setDeletingPicked(false)
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
            suggestions={suggestedTags.names}
            suggesting={suggestedTags.loading}
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
            tags={tags}
            onAdd={handleAddSuggestion}
            onError={setErrorMessage}
          />
        )}

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
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
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    <AddToDeck
                      decks={decks}
                      count={pickedIds.length}
                      busy={deckBusy || deletingPicked}
                      onAdd={(deck) => void handleAddToDeck(deck)}
                      onCreate={handleCreateDeck}
                    />
                    <DeleteCards
                      count={pickedIds.length}
                      busy={deckBusy || deletingPicked}
                      onDelete={handleDeletePicked}
                    />
                  </Box>
                </Box>
                <List disablePadding>
                  {visibleCards.map((card) => (
                    <FlashCardItem
                      key={card.id}
                      card={card}
                      edit={editor.edit?.id === card.id ? editor.edit : null}
                      tags={tags}
                      picture={editor.picture}
                      busy={
                        busyId === card.id ||
                        (editor.saving && editor.edit?.id === card.id)
                      }
                      picked={picked.has(card.id)}
                      onPick={() => togglePicked(card.id)}
                      onEdit={() => editor.start(card)}
                      onEditChange={editor.change}
                      onEditCancel={editor.cancel}
                      onEditSave={(event) => void editor.save(event)}
                      onDelete={() => setConfirmingDelete(card)}
                    />
                  ))}
                </List>
              </>
            )}
          </>
        )}
        {confirmingDelete !== null && (
          <ConfirmDelete
            open
            title={`Delete "${formatWords(confirmingDelete.spanish)}"?`}
            busy={busyId === confirmingDelete.id}
            onCancel={() => setConfirmingDelete(null)}
            onConfirm={() => void handleDelete(confirmingDelete)}
          >
            {cardDeleteWarning(1)}
          </ConfirmDelete>
        )}
      </Paper>
    </Stack>
  )
}

export default FlashCardsPage
