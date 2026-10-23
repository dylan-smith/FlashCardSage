import { useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
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
  exportDeck,
  getDeck,
  renameDeck,
} from '../api/decks'
import type { Deck } from '../api/decks'
import { formatWords, listFlashCards } from '../api/flashCards'
import type { FlashCard, Tag } from '../api/flashCards'
import { listTags } from '../api/tags'
import { trackEvent } from '../telemetry'
import { showToast } from '../toasts'
import { CardActionButton } from '../components/cards/CardActionButton'
import { CardPicker } from '../components/cards/CardPicker'
import { ConfirmDeleteCard } from '../components/cards/ConfirmDeleteCard'
import { ConfirmDeleteDeck } from '../components/cards/ConfirmDeleteDeck'
import { DeleteCards } from '../components/cards/DeleteCards'
import { cardCount } from '../lib/cardCount'
import { FlashCardEditForm } from '../components/cards/FlashCardForm'
import { RenameForm } from '../components/cards/FlashCardTags'
import { useCardEditor, withNewTags } from '../hooks/useCardEditor'
import { useAction } from '../hooks/useAction'
import { useConfirm } from '../hooks/useConfirm'
import { useDeleteCards } from '../hooks/useDeleteCards'
import { useLoad } from '../hooks/useLoad'
import { EmptyText } from '../components/common/EmptyText'
import { Loading } from '../components/common/Loading'
import { Section } from '../components/common/Section'
import { TabPanel } from '../components/common/TabPanel'

// The deck's own cards, or the user's other cards to add to it.
type DeckTab = 'deck' | 'add'

// What the page loads.
type DeckPageData = {
  deck: Deck | null
  cards: FlashCard[]
  tags: Tag[]
  tab: DeckTab
}

// The toast for the last change to the deck's cards, so a new one replaces it.
const deckToast = 'deck-cards'

// One deck: its cards, which can be edited, taken out or deleted, and the user's other cards, which can be edited,
// deleted or put in.
// Each change is saved as it's made.
function DeckPage() {
  const { id } = useParams()
  // The deck (null when the user has no such deck), the user's cards, their tags, which the edit form offers, and the
  // tab that's showing. Undefined while loading.
  const page = useLoad(
    async (): Promise<DeckPageData> => {
      const deckId = Number(id)
      const [deck, cards, tags] = await Promise.all([
        Number.isInteger(deckId) ? getDeck(deckId) : Promise.resolve(null),
        listFlashCards(),
        listTags(),
      ])
      // A new deck has nothing to show yet, so it opens on adding cards. It's only picked here, so adding the first
      // cards doesn't switch tabs.
      return {
        deck,
        cards,
        tags,
        tab: deck?.flashCardIds.length ? 'deck' : 'add',
      }
    },
    [id],
    { operation: 'load', fallback: 'Unable to load the deck.' },
  )

  if (page.failed) {
    return <Alert severity="error">{page.error}</Alert>
  }

  if (page.data === undefined) {
    return <Loading />
  }

  if (page.data.deck === null) {
    return (
      <Section>
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h5" component="h2">
            Deck not found
          </Typography>
          <EmptyText>
            This deck doesn&apos;t exist, or it was deleted.
          </EmptyText>
          <Button component={Link} to="/decks" variant="contained">
            Go to decks
          </Button>
        </Stack>
      </Section>
    )
  }

  return (
    <DeckView
      {...page.data}
      deck={page.data.deck}
      change={(update) =>
        page.setData((data) => data && { ...data, ...update(data) })
      }
    />
  )
}

// The deck once it's loaded. change changes what was loaded.
function DeckView({
  deck,
  cards,
  tags,
  tab,
  change,
}: DeckPageData & {
  deck: Deck
  change: (update: (data: DeckPageData) => Partial<DeckPageData>) => void
}) {
  const navigate = useNavigate()
  // The new name being typed, or null when the deck isn't being renamed.
  const [name, setName] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const action = useAction(setErrorMessage)
  // The card whose Delete was clicked, or the deck itself, while the user is asked whether they mean it.
  const confirm = useConfirm<FlashCard | 'deck'>()
  // The card being edited, which is the same card on every deck and the cards page.
  const editor = useCardEditor({
    setErrorMessage,
    onSaved: (card) => {
      change((data) => ({
        cards: data.cards.map((item) => (item.id === card.id ? card : item)),
        tags: withNewTags(data.tags, card),
      }))
    },
  })
  // Deletes the cards themselves, not just from this deck, so they're gone from every deck and the cards page too.
  const deletingCards = useDeleteCards({
    setErrorMessage,
    operation: 'deleteCards',
    toastKey: deckToast,
    editor,
    onDeleted: (deleted) =>
      change((data) => ({
        cards: data.cards.filter((card) => !deleted.has(card.id)),
        deck: {
          ...deck,
          flashCardIds: deck.flashCardIds.filter(
            (cardId) => !deleted.has(cardId),
          ),
        },
      })),
  })
  const busy = action.busy || deletingCards.busy

  const inDeck = new Set(deck.flashCardIds)
  const deckCards = cards.filter((card) => inDeck.has(card.id))
  const otherCards = cards.filter((card) => !inDeck.has(card.id))

  async function handleRename(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = (name ?? '').trim()
    if (!trimmed) {
      setErrorMessage(deckNameRequiredMessage)
      return
    }

    await action.run(
      { operation: 'rename', fallback: 'Unable to rename deck.' },
      async () => {
        const renamed = await renameDeck(deck.id, trimmed)
        change(() => ({ deck: renamed }))
        trackEvent('DeckRenamed')
        setName(null)
      },
    )
  }

  function handleChange(add: number[], remove: number[]) {
    return action.run(
      { operation: 'changeCards', fallback: 'Unable to change the deck.' },
      async () => {
        const changed = await changeDeckCards(deck.id, { add, remove })
        change(() => ({ deck: changed }))
        trackEvent(add.length > 0 ? 'DeckCardsAdded' : 'DeckCardsRemoved')
        showToast({
          key: deckToast,
          severity: 'success',
          message:
            add.length > 0
              ? `Added ${cardCount(add.length)} to the deck.`
              : `Removed ${cardCount(remove.length)} from the deck.`,
        })
      },
    )
  }

  // Saves the deck as a file to share, such as with a teacher's students, who import it on their decks page.
  async function handleExport() {
    await action.run(
      { operation: 'export', fallback: 'Unable to export the deck.' },
      async () => {
        await exportDeck(deck)
        trackEvent('DeckExported')
      },
    )
  }

  // Stays busy once the deck's deleted, while the decks page opens.
  async function handleDelete() {
    const deleted = await action.run(
      {
        operation: 'delete',
        fallback: 'Unable to delete deck.',
        reportAll: true,
        keepBusy: true,
      },
      async () => {
        await deleteDeck(deck.id)
        trackEvent('DeckDeleted')
        await navigate('/decks')
      },
    )
    if (!deleted) {
      confirm.close()
    }
  }

  async function handleDeleteCard(card: FlashCard) {
    await deletingCards.deleteCards([card.id])
    confirm.close()
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
          onClick={() => confirm.ask(card)}
        />
      </>
    )
  }

  const confirming = confirm.target

  return (
    <Stack spacing={2}>
      <Box>
        <Button component={Link} to="/decks" size="small">
          ← All decks
        </Button>
      </Box>
      <Section>
        <Typography
          variant="h4"
          component="h2"
          sx={{ overflowWrap: 'anywhere' }}
        >
          {deck.name}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          {cardCount(deck.flashCardIds.length)}
        </Typography>
        {name === null ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Button
              component={Link}
              to={`/practice?deck=${deck.id}`}
              aria-label={`Practice deck "${deck.name}"`}
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
                setName(deck.name)
              }}
            >
              Rename
            </Button>
            <Button
              type="button"
              size="small"
              disabled={busy || deck.flashCardIds.length === 0}
              onClick={() => void handleExport()}
            >
              Export
            </Button>
            <Button
              type="button"
              size="small"
              color="error"
              disabled={busy}
              onClick={() => confirm.ask('deck')}
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
      </Section>

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      {/* Tabs rather than one list after the other, since a deck's list can be a page of 50 cards long. Both stay
          mounted, so each keeps its search while the other is shown. */}
      <Section sx={{ pt: 1 }}>
        <Tabs
          value={tab}
          onChange={(_event, value: DeckTab) => change(() => ({ tab: value }))}
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
        <TabPanel group="deck" value="deck" current={tab}>
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
                onDelete={async () => {
                  await deletingCards.deleteCards(ids)
                }}
              />
            )}
            edit={edit}
            rowActions={rowActions}
          />
        </TabPanel>
        <TabPanel group="deck" value="add" current={tab}>
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
        </TabPanel>
      </Section>

      {confirming === 'deck' ? (
        <ConfirmDeleteDeck
          {...confirm.dialogProps}
          name={deck.name}
          busy={busy}
          onConfirm={() => void handleDelete()}
        />
      ) : (
        confirming !== null && (
          <ConfirmDeleteCard
            {...confirm.dialogProps}
            card={confirming}
            busy={busy}
            onConfirm={() => void handleDeleteCard(confirming)}
          />
        )
      )}
    </Stack>
  )
}

export default DeckPage
