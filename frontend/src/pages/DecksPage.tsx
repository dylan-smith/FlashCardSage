import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useNavigate } from 'react-router'
import { createDeck, deleteDeck, listDecks } from '../api/decks'
import type { Deck } from '../api/decks'
import { ApiError, describeFetchError } from '../api/flashCards'
import { trackEvent, trackException } from '../telemetry'
import { cardCount } from './cardCount'
import { ConfirmDelete } from './ConfirmDelete'

export const deckNameRequiredMessage = 'Deck name is required.'

// The most a deck name can be, as the API allows.
export const deckNameMaxLength = 50

// The user's decks. A new deck opens on its own page, where its cards are picked.
function DecksPage() {
  const navigate = useNavigate()
  const [decks, setDecks] = useState<Deck[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // The deck being deleted, so its buttons can wait for the API.
  const [busyId, setBusyId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  // The deck whose Delete was clicked, while the user is asked whether they mean it.
  const [confirmingDelete, setConfirmingDelete] = useState<Deck | null>(null)

  // Loads the decks once. The page starts out loading, and deleting keeps the list up to date itself.
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
          trackException(error, { operation: 'load' })
          setLoadFailed(true)
          setErrorMessage(describeFetchError(error, 'Unable to load decks.'))
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

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setErrorMessage(deckNameRequiredMessage)
      return
    }

    setSubmitting(true)
    setErrorMessage('')

    try {
      const created = await createDeck({ name: trimmed, flashCardIds: [] })
      trackEvent('DeckCreated')
      await navigate(`/decks/${created.id}`)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'create' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to save deck.'))
      setSubmitting(false)
    }
  }

  async function handleDelete(deck: Deck) {
    setBusyId(deck.id)
    setErrorMessage('')

    try {
      await deleteDeck(deck.id)
      trackEvent('DeckDeleted')
      setDecks((current) => current.filter((item) => item.id !== deck.id))
    } catch (error) {
      trackException(error, { operation: 'delete' })
      setErrorMessage(describeFetchError(error, 'Unable to delete deck.'))
    } finally {
      setBusyId(null)
      setConfirmingDelete(null)
    }
  }

  return (
    <Stack spacing={2}>
      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          New deck
        </Typography>
        <Box
          component="form"
          onSubmit={(event) => void handleCreate(event)}
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'flex-start' },
            gap: 2,
          }}
        >
          <TextField
            id="deck-name"
            label="Deck name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: deckNameMaxLength } }}
            required
            placeholder="e.g. Week 1"
            sx={{ flexGrow: 1 }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={submitting}
            sx={{ flexShrink: 0, alignSelf: { sm: 'center' } }}
          >
            {submitting ? 'Saving…' : 'Create deck'}
          </Button>
        </Box>
      </Paper>

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          Decks
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading" />
          </Box>
        ) : loadFailed ? null : decks.length === 0 ? (
          <Typography color="text.secondary">
            You haven&apos;t made any decks yet.
          </Typography>
        ) : (
          <List disablePadding>
            {decks.map((deck) => (
              <ListItem
                key={deck.id}
                divider
                disablePadding
                sx={{ py: 1, gap: 1 }}
              >
                {/* The name wraps rather than the buttons, so they stay together on a phone. */}
                <ListItemText
                  primary={
                    <Link component={RouterLink} to={`/decks/${deck.id}`}>
                      {deck.name}
                    </Link>
                  }
                  secondary={cardCount(deck.flashCardIds.length)}
                  sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                />
                <Box sx={{ display: 'flex', flexShrink: 0 }}>
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
                    disabled={busyId === deck.id}
                    onClick={() => setConfirmingDelete(deck)}
                  >
                    Delete
                  </Button>
                </Box>
              </ListItem>
            ))}
          </List>
        )}
        {confirmingDelete !== null && (
          <ConfirmDelete
            open
            title={`Delete deck "${confirmingDelete.name}"?`}
            busy={busyId === confirmingDelete.id}
            onCancel={() => setConfirmingDelete(null)}
            onConfirm={() => void handleDelete(confirmingDelete)}
          >
            This can&apos;t be undone. Its cards won&apos;t be deleted, and keep
            their scores.
          </ConfirmDelete>
        )}
      </Paper>
    </Stack>
  )
}

export default DecksPage
