import { useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { Link as RouterLink, useSearchParams } from 'react-router'
import {
  changeDeckCards,
  createDeck,
  deckNameRequiredMessage,
  listDecks,
} from '../api/decks'
import type { Deck } from '../api/decks'
import {
  createFlashCard,
  deleteFlashCard,
  deleteFlashCards,
  formatWords,
  listFlashCards,
} from '../api/flashCards'
import { describeFetchError } from '../api/client'
import type { FlashCard, FlashCardFields, Tag } from '../api/flashCards'
import { byName } from '../lib/text'
import { putCardImage } from '../api/cardImages'
import { listTags } from '../api/tags'
import { useAutoTranslate } from '../hooks/useAutoTranslate'
import { useCardPicture } from '../hooks/useCardPicture'
import type { CardPicture } from '../hooks/useCardPicture'
import { usePreferences } from '../hooks/usePreferences'
import { useTagSuggestions } from '../hooks/useTagSuggestions'
import {
  AnimatedList,
  AnimatedListItem,
} from '../components/common/AnimatedList'
import { CardActionButton } from '../components/cards/CardActionButton'
import { trackEvent } from '../telemetry'
import { reportFailure } from '../lib/reportFailure'
import { useAction } from '../hooks/useAction'
import { useConfirm } from '../hooks/useConfirm'
import { useLoad } from '../hooks/useLoad'
import { EmptyText } from '../components/common/EmptyText'
import { Loading } from '../components/common/Loading'
import { Section } from '../components/common/Section'
import { showToast } from '../toasts'
import { PictureField } from '../components/cards/FlashCardPicture'
import { FlashCardRow } from '../components/cards/FlashCardRow'
import { AddToDeck } from '../components/cards/AddToDeck'
import type { Candidate } from '../lib/candidates'
import { CardSuggestions } from '../components/cards/CardSuggestions'
import { matchesSearch } from '../lib/cardSearch'
import { ConfirmDelete } from '../components/common/ConfirmDelete'
import { cardDeleteWarning } from '../lib/cardDeleteWarning'
import { DeleteCards } from '../components/cards/DeleteCards'
import { cardCount } from '../lib/cardCount'
import {
  firstWords,
  pictureWords,
  setFirstWords,
  trimFields,
  updateWords,
} from '../lib/cardFields'
import type { FieldsUpdate } from '../lib/cardFields'
import {
  FlashCardEditForm,
  WordFields,
} from '../components/cards/FlashCardForm'
import { TagFilter, TagsInput } from '../components/cards/FlashCardTags'
import { useCardEditor, withNewTags, withPicture } from '../hooks/useCardEditor'
import type { EditedFlashCard } from '../hooks/useCardEditor'

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
  const [fields, setFields] = useState<FlashCardFields>(emptyFields)
  const [errorMessage, setErrorMessage] = useState('')
  // The list and the user's tags in name order, including any no card has any more, loaded once. The page starts out
  // loading, and the other actions keep both up to date themselves.
  const page = useLoad(
    async () => {
      const [cards, tags] = await Promise.all([listFlashCards(), listTags()])
      return { cards, tags }
    },
    [],
    {
      operation: 'load',
      fallback: 'Unable to load flash cards.',
      onError: setErrorMessage,
      initial: { cards: [] as FlashCard[], tags: [] as Tag[] },
    },
  )
  const { cards, tags } = page.data
  const creating = useAction(setErrorMessage)
  // The card being deleted, so its buttons can wait for the API.
  const deleting = useAction<number>(setErrorMessage)
  const addingSuggestion = useAction(setErrorMessage)
  // The card last added with the form since a tag was picked, which the suggestions are related to.
  const [addedId, setAddedId] = useState<number | null>(null)
  // The user's decks, to add the picked cards to. They're only needed for that, so the list still shows if they don't
  // load.
  const { data: decks, setData: setDecks } = useLoad(() => listDecks(), [], {
    operation: 'loadDecks',
    initial: [] as Deck[],
  })
  // The cards picked to add to a deck or delete.
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const deckAction = useAction(setErrorMessage)
  const deletingPicked = useAction(setErrorMessage)
  // The card whose Delete was clicked, while the user is asked whether they mean it.
  const confirm = useConfirm<FlashCard>()
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
  const tagCards =
    selectedTag === null
      ? cards
      : cards.filter((card) =>
          card.tags.some((tag) => tag.id === selectedTag.id),
        )
  // The search narrows the list as it's typed, like the deck page's.
  const [search, setSearch] = useState('')
  const visibleCards = tagCards.filter((card) => matchesSearch(card, search))
  const tagCounts = new Map<number, number>()
  for (const tag of cards.flatMap((card) => card.tags)) {
    tagCounts.set(tag.id, (tagCounts.get(tag.id) ?? 0) + 1)
  }
  // Only the picked cards that are shown count, so a card hidden by the tag filter or the search is never added to a
  // deck or deleted.
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

  function setCards(update: (current: FlashCard[]) => FlashCard[]) {
    page.setData((current) => ({ ...current, cards: update(current.cards) }))
  }

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
    await deckAction.run(
      {
        operation: 'addToDeck',
        fallback: 'Unable to add the cards to the deck.',
      },
      async () => {
        const updated = await changeDeckCards(deck.id, { add: pickedIds })
        trackEvent('DeckCardsAdded')
        setDecks((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        )
        showDeckNotice(updated, pickedIds.length)
        setPicked(new Set())
      },
    )
  }

  // Resolves to why the deck wasn't made, or null when it was.
  async function handleCreateDeck(name: string): Promise<string | null> {
    const trimmed = name.trim()
    if (!trimmed) {
      return deckNameRequiredMessage
    }

    let problem: string | null = null
    await deckAction.run(
      {
        operation: 'createDeck',
        fallback: 'Unable to save deck.',
        onError: (message) => {
          problem = message
        },
      },
      async () => {
        const created = await createDeck({
          name: trimmed,
          flashCardIds: pickedIds,
        })
        trackEvent('DeckCreated')
        setDecks((current) => [...current, created].sort(byName))
        showDeckNotice(created, pickedIds.length)
        setPicked(new Set())
      },
    )
    return problem
  }

  // A saved card can have tags the API just made for new names, so they're added to the user's tags.
  function addNewTags(card: FlashCard) {
    page.setData((current) => ({
      ...current,
      tags: withNewTags(current.tags, card),
    }))
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
        setCards((current) => [...current, card])
        setAddedId(card.id)
        addNewTags(card)
      },
    )
  }

  // Adds a suggested card, with any changes the user made to it, returning whether it was saved. The card is saved
  // whatever happens to its picture, so a failure there is reported and the card kept without it.
  function handleAddSuggestion({
    spanish,
    english,
    tags: tagNames,
    picture,
  }: Candidate) {
    return addingSuggestion.run(
      { operation: 'addSuggestion', fallback: 'Unable to save flash card.' },
      async () => {
        let card = await createFlashCard({ spanish, english, tags: tagNames })
        trackEvent('SuggestedFlashCardAdded')
        if (picture !== null) {
          try {
            card = await putCardImage(card.id, picture)
            trackEvent('FlashCardImageAdded')
          } catch (error) {
            reportFailure(error, 'picture')
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
      },
    )
  }

  async function handleDelete(card: FlashCard) {
    await deleting.run(
      {
        operation: 'delete',
        fallback: 'Unable to delete flash card.',
        key: card.id,
        reportAll: true,
      },
      async () => {
        await deleteFlashCard(card.id)
        trackEvent('FlashCardDeleted')
        setCards((current) => current.filter((item) => item.id !== card.id))
      },
    )
    confirm.close()
  }

  async function handleDeletePicked() {
    const ids = new Set(pickedIds)
    await deletingPicked.run(
      {
        operation: 'deleteMany',
        fallback: 'Unable to delete the flash cards.',
        reportAll: true,
      },
      async () => {
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
      },
    )
  }

  function selectTag(tag: Tag | null) {
    setPicked(new Set())
    // The suggestions go back to being about the tag's cards, not a card added before.
    setAddedId(null)
    setSearchParams(tag === null ? {} : { tag: String(tag.id) })
  }

  const confirming = confirm.target

  return (
    <Stack spacing={2}>
      <Section title="Add flash card">
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
      </Section>

      {/* With a tag in the URL, the suggestions wait for the tags, so they aren't asked for twice. */}
      {preferences?.showSuggestions === true &&
        !(page.loading && searchParams.has('tag')) && (
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
      <Section title="Flash cards">
        {page.loading ? (
          <Loading />
        ) : page.failed ? null : (
          <>
            {cards.length > 0 && (
              <TextField
                label="Search"
                type="search"
                size="small"
                fullWidth
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPicked(new Set())
                }}
                sx={{ mb: 2 }}
              />
            )}
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
              <EmptyText>No flash cards yet.</EmptyText>
            ) : tagCards.length === 0 ? (
              <EmptyText>No flash cards with this tag.</EmptyText>
            ) : visibleCards.length === 0 ? (
              <EmptyText>No cards match.</EmptyText>
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
                      busy={deckAction.busy || deletingPicked.busy}
                      onAdd={(deck) => void handleAddToDeck(deck)}
                      onCreate={handleCreateDeck}
                    />
                    <DeleteCards
                      count={pickedIds.length}
                      busy={deckAction.busy || deletingPicked.busy}
                      onDelete={handleDeletePicked}
                    />
                  </Box>
                </Box>
                {/* Keyed on the filters, so changing them swaps the cards at once. */}
                <AnimatedList
                  key={`${selectedTag?.id ?? 'all'}|${search}`}
                  disablePadding
                >
                  {visibleCards.map((card) => {
                    const editing = editor.edit?.id === card.id
                    return (
                      <AnimatedListItem
                        key={editing ? `${card.id}-edit` : card.id}
                      >
                        <FlashCardItem
                          card={card}
                          edit={editing ? editor.edit : null}
                          tags={tags}
                          picture={editor.picture}
                          busy={
                            deleting.busyKey === card.id ||
                            (editor.saving && editing)
                          }
                          picked={picked.has(card.id)}
                          onPick={() => togglePicked(card.id)}
                          onEdit={() => editor.start(card)}
                          onEditChange={editor.change}
                          onEditCancel={editor.cancel}
                          onEditSave={(event) => void editor.save(event)}
                          onDelete={() => confirm.ask(card)}
                        />
                      </AnimatedListItem>
                    )
                  })}
                </AnimatedList>
              </>
            )}
          </>
        )}
        {confirming !== null && (
          <ConfirmDelete
            {...confirm.dialogProps}
            title={`Delete "${formatWords(confirming.spanish)}"?`}
            busy={deleting.busyKey === confirming.id}
            onConfirm={() => void handleDelete(confirming)}
          >
            {cardDeleteWarning(1)}
          </ConfirmDelete>
        )}
      </Section>
    </Stack>
  )
}

export default FlashCardsPage
