import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
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
  formatWords,
  listFlashCards,
} from '../api/flashCards'
import type { FlashCard, Tag } from '../api/flashCards'
import { byName } from '../lib/text'
import { putCardImage } from '../api/cardImages'
import { listTags } from '../api/tags'
import { usePreferences } from '../hooks/usePreferences'
import { CardActionButton } from '../components/cards/CardActionButton'
import { trackEvent } from '../telemetry'
import { useAction } from '../hooks/useAction'
import { useConfirm } from '../hooks/useConfirm'
import { useDeleteCards } from '../hooks/useDeleteCards'
import { useLoad } from '../hooks/useLoad'
import { Loading } from '../components/common/Loading'
import { Section } from '../components/common/Section'
import { showToast } from '../toasts'
import { AddFlashCardForm } from '../components/cards/AddFlashCardForm'
import { AddToDeck } from '../components/cards/AddToDeck'
import type { Candidate } from '../lib/candidates'
import { CardPicker } from '../components/cards/CardPicker'
import { CardSuggestions } from '../components/cards/CardSuggestions'
import { ConfirmDeleteCard } from '../components/cards/ConfirmDeleteCard'
import { DeleteCards } from '../components/cards/DeleteCards'
import { cardCount } from '../lib/cardCount'
import { FlashCardEditForm } from '../components/cards/FlashCardForm'
import { GettingStarted } from '../components/cards/GettingStarted'
import { useCardEditor, withNewTags, withPicture } from '../hooks/useCardEditor'

// The toast for what was just done to the picked cards, so a new one replaces the last.
const cardsPageToast = 'picked-cards'

function FlashCardsPage() {
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
  const deckAction = useAction(setErrorMessage)
  // The card whose Delete was clicked, while the user is asked whether they mean it.
  const confirm = useConfirm<FlashCard>()
  const preferences = usePreferences()
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
  const deletingPicked = useDeleteCards({
    setErrorMessage,
    operation: 'deleteMany',
    toastKey: cardsPageToast,
    editor,
    onDeleted: (deleted) =>
      setCards((current) => current.filter((item) => !deleted.has(item.id))),
  })

  // The tag whose cards are shown is in the URL, so the back button and a refresh keep it. One that doesn't exist
  // (any more) shows every card.
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTag =
    tags.find((tag) => String(tag.id) === searchParams.get('tag')) ?? null
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

  async function handleAddToDeck(
    deck: Deck,
    pickedIds: number[],
    clearPicks: () => void,
  ) {
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
        clearPicks()
      },
    )
  }

  // Resolves to why the deck wasn't made, or null when it was.
  async function handleCreateDeck(
    name: string,
    pickedIds: number[],
    clearPicks: () => void,
  ): Promise<string | null> {
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
        clearPicks()
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

  function handleCreated(card: FlashCard) {
    setCards((current) => [...current, card])
    setAddedId(card.id)
    addNewTags(card)
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
        let card = await createFlashCard(
          { spanish, english, tags: tagNames },
          'Suggested',
        )
        trackEvent('SuggestedFlashCardAdded')
        if (picture !== null) {
          card = await withPicture(
            {
              apply: async (id) => {
                const withImage = await putCardImage(id, picture)
                trackEvent('FlashCardImageAdded')
                return withImage
              },
            },
            card,
            "Flash card saved, but the picture couldn't be added.",
            setErrorMessage,
          )
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

  function selectTag(tagId: number | null) {
    // The suggestions go back to being about the tag's cards, not a card added before.
    setAddedId(null)
    setSearchParams(tagId === null ? {} : { tag: String(tagId) })
  }

  // The card being edited shows its form in its row's place.
  const edit =
    editor.edit === null
      ? undefined
      : {
          id: editor.edit.id,
          form: (
            <FlashCardEditForm
              edit={editor.edit}
              tags={tags}
              picture={editor.picture}
              busy={deleting.busyKey === editor.edit.id || editor.saving}
              onChange={editor.change}
              onCancel={editor.cancel}
              onSave={(event) => void editor.save(event)}
            />
          ),
        }

  function rowActions(card: FlashCard) {
    const spanish = formatWords(card.spanish)
    const busy = deleting.busyKey === card.id
    return (
      <>
        <CardActionButton
          icon="edit"
          text="Edit"
          label={`Edit "${spanish}"`}
          disabled={busy}
          onClick={() => editor.start(card)}
        />
        <CardActionButton
          icon="delete"
          text="Delete"
          label={`Delete "${spanish}"`}
          disabled={busy}
          onClick={() => confirm.ask(card)}
        />
      </>
    )
  }

  const pickedBusy = deckAction.busy || deletingPicked.busy
  const confirming = confirm.target

  return (
    <Stack spacing={2}>
      {/* For a new user, until they hide it. */}
      <GettingStarted onError={setErrorMessage} />
      <Section title="Add flash card">
        <AddFlashCardForm
          tags={tags}
          setErrorMessage={setErrorMessage}
          onCreated={handleCreated}
        />
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
          // Every card on one page, with all the user's tags, and the tag picked in the URL.
          <CardPicker
            cards={cards}
            tags={tags}
            emptyMessage="No flash cards yet."
            tagEmptyMessage="No flash cards with this tag."
            tagId={selectedTag?.id ?? null}
            onTagChange={selectTag}
            pageSize={Number.POSITIVE_INFINITY}
            pageList
            pickedActions={(ids, clearPicks) => (
              <>
                <AddToDeck
                  decks={decks}
                  count={ids.length}
                  busy={pickedBusy}
                  onAdd={(deck) => void handleAddToDeck(deck, ids, clearPicks)}
                  onCreate={(name) => handleCreateDeck(name, ids, clearPicks)}
                />
                <DeleteCards
                  count={ids.length}
                  busy={pickedBusy}
                  onDelete={async () => {
                    if (await deletingPicked.deleteCards(ids)) {
                      clearPicks()
                    }
                  }}
                />
              </>
            )}
            edit={edit}
            rowActions={rowActions}
          />
        )}
        {confirming !== null && (
          <ConfirmDeleteCard
            {...confirm.dialogProps}
            card={confirming}
            busy={deleting.busyKey === confirming.id}
            onConfirm={() => void handleDelete(confirming)}
          />
        )}
      </Section>
    </Stack>
  )
}

export default FlashCardsPage
