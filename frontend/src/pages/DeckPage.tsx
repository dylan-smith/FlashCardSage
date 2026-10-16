import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import { Link, useNavigate, useParams } from 'react-router'
import {
  changeDeckCards,
  deckNameMaxLength,
  deckNameRequiredMessage,
  deleteDeck,
  getDeck,
  renameDeck,
} from '../api/decks'
import type { Deck } from '../api/decks'
import {
  deleteFlashCards,
  formatWords,
  listFlashCards,
} from '../api/flashCards'
import { ApiError, describeFetchError } from '../api/client'
import type { FlashCard, Tag } from '../api/flashCards'
import { listTags } from '../api/tags'
import { trackEvent, trackException } from '../telemetry'
import { showToast } from '../toasts'
import { CardActionButton } from '../components/cards/CardActionButton'
import { CardPicker } from '../components/cards/CardPicker'
import { ConfirmDelete } from '../components/common/ConfirmDelete'
import { cardDeleteWarning } from '../lib/cardDeleteWarning'
import { DeleteCards } from '../components/cards/DeleteCards'
import { cardCount } from '../lib/cardCount'
import { FlashCardEditForm } from '../components/cards/FlashCardForm'
import { RenameForm } from '../components/cards/FlashCardTags'
import { useCardEditor, withNewTags } from '../hooks/useCardEditor'

// The deck's own cards, or the user's other cards to add to it.
type DeckTab = 'deck' | 'add'

// The toast for the last change to the deck's cards, so a new one replaces it.
const deckToast = 'deck-cards'

// One deck: its cards, which can be edited, taken out or deleted, and the user's other cards, which can be edited,
// deleted or put in.
// Each change is saved as it's made.
function DeckPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  // Undefined while loading, and null when the user has no such deck.
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined)
  const [cards, setCards] = useState<FlashCard[]>([])
  // The user's tags, which the edit form offers.
  const [tags, setTags] = useState<Tag[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  // The new name being typed, or null when the deck isn't being renamed.
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [tab, setTab] = useState<DeckTab>('deck')
  // The card whose Delete was clicked, or the deck itself, while the user is asked whether they mean it.
  const [confirmingDelete, setConfirmingDelete] = useState<
    FlashCard | 'deck' | null
  >(null)
  // The card being edited, which is the same card on every deck and the cards page.
  const editor = useCardEditor({
    setErrorMessage,
    onSaved: (card) => {
      setCards((current) =>
        current.map((item) => (item.id === card.id ? card : item)),
      )
      setTags((current) => withNewTags(current, card))
    },
  })

  useEffect(() => {
    let cancelled = false
    const deckId = Number(id)
    Promise.all([
      Number.isInteger(deckId) ? getDeck(deckId) : Promise.resolve(null),
      listFlashCards(),
      listTags(),
    ])
      .then(([loadedDeck, loadedCards, loadedTags]) => {
        if (!cancelled) {
          setDeck(loadedDeck)
          setCards(loadedCards)
          setTags(loadedTags)
          // A new deck has nothing to show yet, so it opens on adding cards. It's only picked here, so adding the
          // first cards doesn't switch tabs.
          setTab(loadedDeck?.flashCardIds.length ? 'deck' : 'add')
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trackException(error, { operation: 'load' })
          setLoadFailed(true)
          setErrorMessage(describeFetchError(error, 'Unable to load the deck.'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loadFailed) {
    return <Alert severity="error">{errorMessage}</Alert>
  }

  if (deck === undefined) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress aria-label="Loading" />
      </Box>
    )
  }

  if (deck === null) {
    return (
      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h5" component="h2">
            Deck not found
          </Typography>
          <Typography color="text.secondary">
            This deck doesn&apos;t exist, or it was deleted.
          </Typography>
          <Button component={Link} to="/decks" variant="contained">
            Go to decks
          </Button>
        </Stack>
      </Paper>
    )
  }

  const current = deck
  const inDeck = new Set(current.flashCardIds)
  const deckCards = cards.filter((card) => inDeck.has(card.id))
  const otherCards = cards.filter((card) => !inDeck.has(card.id))

  async function handleRename(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = (name ?? '').trim()
    if (!trimmed) {
      setErrorMessage(deckNameRequiredMessage)
      return
    }

    setBusy(true)
    setErrorMessage('')
    try {
      setDeck(await renameDeck(current.id, trimmed))
      trackEvent('DeckRenamed')
      setName(null)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'rename' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to rename deck.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleChange(add: number[], remove: number[]) {
    setBusy(true)
    setErrorMessage('')
    try {
      setDeck(await changeDeckCards(current.id, { add, remove }))
      trackEvent(add.length > 0 ? 'DeckCardsAdded' : 'DeckCardsRemoved')
      showToast({
        key: deckToast,
        severity: 'success',
        message:
          add.length > 0
            ? `Added ${cardCount(add.length)} to the deck.`
            : `Removed ${cardCount(remove.length)} from the deck.`,
      })
      return true
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'changeCards' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to change the deck.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  // Deletes the cards themselves, not just from this deck, so they're gone from every deck and the cards page too.
  async function handleDeleteCards(ids: number[]) {
    setBusy(true)
    setErrorMessage('')
    try {
      await deleteFlashCards(ids)
      trackEvent('FlashCardsDeleted')
      const deleted = new Set(ids)
      setCards((loaded) => loaded.filter((card) => !deleted.has(card.id)))
      if (editor.edit !== null && deleted.has(editor.edit.id)) {
        editor.cancel()
      }
      setDeck({
        ...current,
        flashCardIds: current.flashCardIds.filter(
          (cardId) => !deleted.has(cardId),
        ),
      })
      showToast({
        key: deckToast,
        severity: 'success',
        message: `Deleted ${cardCount(ids.length)}.`,
      })
    } catch (error) {
      trackException(error, { operation: 'deleteCards' })
      setErrorMessage(
        describeFetchError(error, 'Unable to delete the flash cards.'),
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    setErrorMessage('')
    try {
      await deleteDeck(current.id)
      trackEvent('DeckDeleted')
      await navigate('/decks')
    } catch (error) {
      trackException(error, { operation: 'delete' })
      setErrorMessage(describeFetchError(error, 'Unable to delete deck.'))
      setBusy(false)
      setConfirmingDelete(null)
    }
  }

  async function handleDeleteCard(card: FlashCard) {
    await handleDeleteCards([card.id])
    setConfirmingDelete(null)
  }

  // The card being edited is in one tab's list or the other, which shows its form in its place.
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
              busy={editor.saving}
              onChange={editor.change}
              onCancel={editor.cancel}
              onSave={(event) => void editor.save(event)}
            />
          ),
        }

  // Every card can be edited or deleted, and the deck's own cards can be taken out of it.
  function rowActions(card: FlashCard) {
    const spanish = formatWords(card.spanish)
    return (
      <>
        <CardActionButton
          icon="edit"
          text="Edit"
          label={`Edit "${spanish}"`}
          disabled={busy}
          onClick={() => editor.start(card)}
        />
        {inDeck.has(card.id) && (
          <CardActionButton
            icon="remove"
            text="Remove from deck"
            label={`Remove "${spanish}" from deck`}
            disabled={busy}
            onClick={() => void handleChange([], [card.id])}
          />
        )}
        <CardActionButton
          icon="delete"
          text="Delete"
          label={`Delete "${spanish}"`}
          disabled={busy}
          onClick={() => setConfirmingDelete(card)}
        />
      </>
    )
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Button component={Link} to="/decks" size="small">
          ← All decks
        </Button>
      </Box>
      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        <Typography
          variant="h4"
          component="h2"
          sx={{ overflowWrap: 'anywhere' }}
        >
          {current.name}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          {cardCount(current.flashCardIds.length)}
        </Typography>
        {name === null ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Button
              component={Link}
              to={`/practice?deck=${current.id}`}
              aria-label={`Practice deck "${current.name}"`}
              variant="contained"
              size="small"
            >
              Practice
            </Button>
            <Button
              type="button"
              size="small"
              disabled={busy}
              onClick={() => {
                setErrorMessage('')
                setName(current.name)
              }}
            >
              Rename
            </Button>
            <Button
              type="button"
              size="small"
              color="error"
              disabled={busy}
              onClick={() => setConfirmingDelete('deck')}
            >
              Delete deck
            </Button>
          </Box>
        ) : (
          <RenameForm
            name={name}
            busy={busy}
            label="Deck name"
            maxLength={deckNameMaxLength}
            onChange={setName}
            onCancel={() => {
              setErrorMessage('')
              setName(null)
            }}
            onSave={(event) => void handleRename(event)}
          />
        )}
      </Paper>

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      {/* Tabs rather than one list after the other, since a deck's list can be a page of 50 cards long. Both stay
          mounted, so each keeps its search while the other is shown. */}
      <Paper component="section" elevation={2} sx={{ p: 3, pt: 1 }}>
        <Tabs
          value={tab}
          onChange={(_event, value: DeckTab) => setTab(value)}
          aria-label="Cards"
          sx={{ mb: 2 }}
        >
          <Tab
            value="deck"
            label={`In this deck (${deckCards.length})`}
            id="deck-tab-deck"
            aria-controls="deck-panel-deck"
          />
          <Tab
            value="add"
            label={`Add cards (${otherCards.length})`}
            id="deck-tab-add"
            aria-controls="deck-panel-add"
          />
        </Tabs>
        <Box
          role="tabpanel"
          id="deck-panel-deck"
          aria-labelledby="deck-tab-deck"
          hidden={tab !== 'deck'}
        >
          <CardPicker
            cards={deckCards}
            emptyMessage="This deck has no cards yet. Add some from the Add cards tab."
            actionLabel={(cards) => `Remove ${cards} from deck`}
            busy={busy}
            onApply={(ids) => handleChange([], ids)}
            pickedActions={(ids) => (
              <DeleteCards
                count={ids.length}
                busy={busy}
                onDelete={() => handleDeleteCards(ids)}
              />
            )}
            edit={edit}
            rowActions={rowActions}
          />
        </Box>
        <Box
          role="tabpanel"
          id="deck-panel-add"
          aria-labelledby="deck-tab-add"
          hidden={tab !== 'add'}
        >
          <CardPicker
            cards={otherCards}
            emptyMessage={
              cards.length === 0
                ? 'You have no flash cards yet.'
                : 'Every card is in this deck.'
            }
            actionLabel={(cards) => `Add ${cards}`}
            busy={busy}
            onApply={(ids) => handleChange(ids, [])}
            edit={edit}
            rowActions={rowActions}
          />
        </Box>
      </Paper>

      {confirmingDelete === 'deck' ? (
        <ConfirmDelete
          open
          title={`Delete deck "${current.name}"?`}
          busy={busy}
          onCancel={() => setConfirmingDelete(null)}
          onConfirm={() => void handleDelete()}
        >
          This can&apos;t be undone. Its cards won&apos;t be deleted, and keep
          their scores.
        </ConfirmDelete>
      ) : (
        confirmingDelete !== null && (
          <ConfirmDelete
            open
            title={`Delete "${formatWords(confirmingDelete.spanish)}"?`}
            busy={busy}
            onCancel={() => setConfirmingDelete(null)}
            onConfirm={() => void handleDeleteCard(confirmingDelete)}
          >
            {cardDeleteWarning(1)}
          </ConfirmDelete>
        )
      )}
    </Stack>
  )
}

export default DeckPage
