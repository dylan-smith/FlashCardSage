import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  ApiError,
  createFlashCard,
  deleteFlashCard,
  describeFetchError,
  listFlashCards,
  updateFlashCard,
} from '../api/flashCards'
import type { FlashCard } from '../api/flashCards'
import { trackEvent, trackException } from '../telemetry'

export const titleRequiredMessage = 'Title is required.'

type EditState = {
  id: number
  title: string
}

// The form that replaces a card in the list while its title is being changed. The field gets focus when the
// form appears, since the user just asked to edit it.
function FlashCardEditForm({
  edit,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  edit: EditState
  busy: boolean
  onChange: (title: string) => void
  onCancel: () => void
  onSave: (event: SubmitEvent<HTMLFormElement>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <ListItem divider disablePadding sx={{ py: 1 }}>
      <Box
        component="form"
        onSubmit={onSave}
        sx={{ display: 'flex', flexGrow: 1, gap: 1, alignItems: 'center' }}
      >
        <TextField
          label="Title"
          value={edit.title}
          onChange={(event) => onChange(event.target.value)}
          inputRef={inputRef}
          slotProps={{ htmlInput: { maxLength: 200 } }}
          size="small"
          fullWidth
        />
        <Button
          type="submit"
          variant="contained"
          size="small"
          disabled={busy}
          sx={{ flexShrink: 0 }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          size="small"
          disabled={busy}
          onClick={onCancel}
          sx={{ flexShrink: 0 }}
        >
          Cancel
        </Button>
      </Box>
    </ListItem>
  )
}

// One card in the list: its title with Edit and Delete buttons, or, while it's being edited, the form above.
function FlashCardItem({
  card,
  edit,
  busy,
  onEdit,
  onEditChange,
  onEditCancel,
  onEditSave,
  onDelete,
}: {
  card: FlashCard
  edit: EditState | null
  busy: boolean
  onEdit: () => void
  onEditChange: (title: string) => void
  onEditCancel: () => void
  onEditSave: (event: SubmitEvent<HTMLFormElement>) => void
  onDelete: () => void
}) {
  if (edit !== null) {
    return (
      <FlashCardEditForm
        edit={edit}
        busy={busy}
        onChange={onEditChange}
        onCancel={onEditCancel}
        onSave={onEditSave}
      />
    )
  }

  return (
    <ListItem divider disablePadding sx={{ py: 1, gap: 1 }}>
      <ListItemText primary={card.title} sx={{ overflowWrap: 'anywhere' }} />
      <Button
        type="button"
        size="small"
        disabled={busy}
        aria-label={`Edit "${card.title}"`}
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
        aria-label={`Delete "${card.title}"`}
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
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  // Set when the list couldn't be loaded, so the page doesn't claim there are no cards.
  const [loadFailed, setLoadFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // The card being edited, with its title as typed so far. One at a time keeps the list simple.
  const [edit, setEdit] = useState<EditState | null>(null)
  // The card whose edit is being saved or that is being deleted, so its buttons can wait for the API.
  const [busyId, setBusyId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  // Loads the list once. The page starts out loading, and the other actions keep the list up to date themselves.
  useEffect(() => {
    let cancelled = false
    listFlashCards()
      .then((loaded) => {
        if (!cancelled) {
          setCards(loaded)
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

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setErrorMessage(titleRequiredMessage)
      return
    }

    setSubmitting(true)
    setErrorMessage('')

    try {
      const created = await createFlashCard(trimmedTitle)
      trackEvent('FlashCardCreated')
      setTitle('')
      setCards((current) => [...current, created])
    } catch (error) {
      // A rejected title is the user's to fix, not a failure to report.
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'create' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to save flash card.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEditSave(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (edit === null) {
      return
    }

    const trimmedTitle = edit.title.trim()
    if (!trimmedTitle) {
      setErrorMessage(titleRequiredMessage)
      return
    }

    setBusyId(edit.id)
    setErrorMessage('')

    try {
      const updated = await updateFlashCard(edit.id, trimmedTitle)
      trackEvent('FlashCardUpdated')
      setCards((current) =>
        current.map((card) => (card.id === updated.id ? updated : card)),
      )
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
            id="flash-card-title"
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            required
            placeholder="e.g. el gato"
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? 'Saving…' : 'Add flash card'}
            </Button>
          </Stack>
        </Box>
      </Paper>

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          Flash cards
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading" />
          </Box>
        ) : loadFailed ? null : cards.length === 0 ? (
          <Typography color="text.secondary">No flash cards yet.</Typography>
        ) : (
          <List disablePadding>
            {cards.map((card) => (
              <FlashCardItem
                key={card.id}
                card={card}
                edit={edit?.id === card.id ? edit : null}
                busy={busyId === card.id}
                onEdit={() => {
                  setErrorMessage('')
                  setEdit({ id: card.id, title: card.title })
                }}
                onEditChange={(value) =>
                  setEdit((current) =>
                    current === null ? null : { ...current, title: value },
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
        )}
      </Paper>
    </Stack>
  )
}

export default FlashCardsPage
