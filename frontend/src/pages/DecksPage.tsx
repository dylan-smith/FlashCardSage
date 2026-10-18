import { useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import { Link as RouterLink, useNavigate } from 'react-router'
import {
  createDeck,
  deckNameMaxLength,
  deckNameRequiredMessage,
  deleteDeck,
  listDecks,
} from '../api/decks'
import type { Deck } from '../api/decks'
import { trackEvent } from '../telemetry'
import { useAction } from '../hooks/useAction'
import { useConfirm } from '../hooks/useConfirm'
import { useLoad } from '../hooks/useLoad'
import { EmptyText } from '../components/common/EmptyText'
import { Loading } from '../components/common/Loading'
import { NameForm } from '../components/common/NameForm'
import { NamedItemRow } from '../components/common/NamedItemRow'
import { Section } from '../components/common/Section'
import {
  AnimatedList,
  AnimatedListItem,
} from '../components/common/AnimatedList'
import { cardCount } from '../lib/cardCount'
import { ConfirmDeleteDeck } from '../components/cards/ConfirmDeleteDeck'

// The user's decks. A new deck opens on its own page, where its cards are picked.
function DecksPage() {
  const navigate = useNavigate()
  const [errorMessage, setErrorMessage] = useState('')
  // Loads the decks once. The page starts out loading, and deleting keeps the list up to date itself.
  const {
    data: decks,
    setData: setDecks,
    loading,
    failed: loadFailed,
  } = useLoad(() => listDecks(), [], {
    operation: 'load',
    fallback: 'Unable to load decks.',
    onError: setErrorMessage,
    initial: [] as Deck[],
  })
  const [name, setName] = useState('')
  const creating = useAction(setErrorMessage)
  // The deck being deleted, so its buttons can wait for the API.
  const deleting = useAction<number>(setErrorMessage)
  // The deck whose Delete was clicked, while the user is asked whether they mean it.
  const confirm = useConfirm<Deck>()
  const confirming = confirm.target

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setErrorMessage(deckNameRequiredMessage)
      return
    }

    // Stays busy once the deck's made, while its page opens.
    await creating.run(
      { operation: 'create', fallback: 'Unable to save deck.', keepBusy: true },
      async () => {
        const created = await createDeck({ name: trimmed, flashCardIds: [] })
        trackEvent('DeckCreated')
        await navigate(`/decks/${created.id}`)
      },
    )
  }

  async function handleDelete(deck: Deck) {
    await deleting.run(
      {
        operation: 'delete',
        fallback: 'Unable to delete deck.',
        key: deck.id,
        reportAll: true,
      },
      async () => {
        await deleteDeck(deck.id)
        trackEvent('DeckDeleted')
        setDecks((current) => current.filter((item) => item.id !== deck.id))
      },
    )
    confirm.close()
  }

  return (
    <Stack spacing={2}>
      <Section title="New deck">
        <NameForm
          id="deck-name"
          label="Deck name"
          placeholder="e.g. Week 1"
          maxLength={deckNameMaxLength}
          value={name}
          busy={creating.busy}
          submitText="Create deck"
          onChange={setName}
          onSubmit={(event) => void handleCreate(event)}
        />
      </Section>

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      <Section title="Decks">
        {loading ? (
          <Loading />
        ) : loadFailed ? null : decks.length === 0 ? (
          <EmptyText>You haven&apos;t made any decks yet.</EmptyText>
        ) : (
          <AnimatedList disablePadding>
            {decks.map((deck) => (
              <AnimatedListItem key={deck.id}>
                <NamedItemRow
                  name={deck.name}
                  to={`/decks/${deck.id}`}
                  secondary={cardCount(deck.flashCardIds.length)}
                >
                  <Button
                    component={RouterLink}
                    to={`/practice?deck=${deck.id}`}
                    aria-label={`Practice deck "${deck.name}"`}
                  >
                    Practice
                  </Button>
                  <Button
                    color="error"
                    aria-label={`Delete deck "${deck.name}"`}
                    disabled={deleting.busyKey === deck.id}
                    onClick={() => confirm.ask(deck)}
                  >
                    Delete
                  </Button>
                </NamedItemRow>
              </AnimatedListItem>
            ))}
          </AnimatedList>
        )}
        {confirming !== null && (
          <ConfirmDeleteDeck
            {...confirm.dialogProps}
            name={confirming.name}
            busy={deleting.busyKey === confirming.id}
            onConfirm={() => void handleDelete(confirming)}
          />
        )}
      </Section>
    </Stack>
  )
}

export default DecksPage
