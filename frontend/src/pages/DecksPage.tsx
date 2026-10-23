import { useState } from 'react'
import type { ChangeEvent, SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useNavigate } from 'react-router'
import {
  createDeck,
  deckFileTypes,
  deckNameMaxLength,
  deckNameRequiredMessage,
  deleteDeck,
  importDeckFile,
  listDecks,
} from '../api/decks'
import type { Deck, DeckImport } from '../api/decks'
import { showToast } from '../toasts'
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

// What importing a deck file did, such as "Imported Lesson 3 with 12 cards." and how many of them the user had already.
function describeImport({
  deck,
  existingCount,
  skippedCount,
  missingPictureCount,
}: DeckImport) {
  const sentences = [
    `Imported ${deck.name} with ${cardCount(deck.flashCardIds.length)}.`,
  ]
  if (existingCount > 0) {
    sentences.push(
      existingCount === 1
        ? 'You already had 1 of them.'
        : `You already had ${existingCount} of them.`,
    )
  }
  if (skippedCount > 0) {
    sentences.push(
      `${cardCount(skippedCount)} that repeated others ${skippedCount === 1 ? 'was' : 'were'} left out.`,
    )
  }
  if (missingPictureCount > 0) {
    sentences.push(
      missingPictureCount === 1
        ? "1 picture isn't on this site, so its card has none."
        : `${missingPictureCount} pictures aren't on this site, so their cards have none.`,
    )
  }
  return sentences.join(' ')
}

// The user's decks. A new deck opens on its own page, where its cards are picked, and so does one imported from a
// file someone shared.
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

  // Stays busy once the deck's imported, while its page opens.
  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Cleared, so picking the same file again imports it again.
    event.target.value = ''
    if (!file) {
      return
    }

    await creating.run(
      {
        operation: 'import',
        fallback: 'Unable to import the deck.',
        keepBusy: true,
      },
      async () => {
        const imported = await importDeckFile(file)
        trackEvent('DeckFileImported')
        showToast({
          key: 'deck-file-imported',
          severity: 'success',
          message: describeImport(imported),
        })
        await navigate(`/decks/${imported.deck.id}`)
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
        <Typography color="text.secondary" sx={{ mt: 2, mb: 1 }}>
          Or import a deck someone shared with you, such as your teacher, from
          its .yml or .zip file. Cards you already have go in it as they are.
        </Typography>
        <Button variant="outlined" component="label" disabled={creating.busy}>
          Import a deck file
          <input
            type="file"
            hidden
            accept={deckFileTypes}
            disabled={creating.busy}
            onChange={(event) => void handleImport(event)}
          />
        </Button>
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
