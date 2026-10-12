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
import type { FlashCard, FlashCardFields } from '../api/flashCards'
import { trackEvent, trackException } from '../telemetry'

export const spanishRequiredMessage = 'Spanish is required.'
export const englishRequiredMessage = 'English is required.'

const emptyFields: FlashCardFields = { spanish: '', english: '' }

// Trims both sides of a card, or returns the message for the first one left blank.
function trimFields(fields: FlashCardFields): FlashCardFields | string {
  const spanish = fields.spanish.trim()
  const english = fields.english.trim()
  if (!spanish) {
    return spanishRequiredMessage
  }
  if (!english) {
    return englishRequiredMessage
  }
  return { spanish, english }
}

// The form that replaces a card in the list while it's being changed. The Spanish field gets focus when the
// form appears, since the user just asked to edit it.
function FlashCardEditForm({
  edit,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  edit: FlashCard
  busy: boolean
  onChange: (change: Partial<FlashCardFields>) => void
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
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          flexGrow: 1,
          gap: 1,
          alignItems: { xs: 'stretch', sm: 'center' },
        }}
      >
        <TextField
          label="Spanish"
          value={edit.spanish}
          onChange={(event) => onChange({ spanish: event.target.value })}
          inputRef={inputRef}
          slotProps={{ htmlInput: { maxLength: 200 } }}
          size="small"
          fullWidth
        />
        <TextField
          label="English"
          value={edit.english}
          onChange={(event) => onChange({ english: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 200 } }}
          size="small"
          fullWidth
        />
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
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

// One card in the list: its Spanish and English with Edit and Delete buttons, or, while it's being edited, the
// form above.
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
  edit: FlashCard | null
  busy: boolean
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
        busy={busy}
        onChange={onEditChange}
        onCancel={onEditCancel}
        onSave={onEditSave}
      />
    )
  }

  return (
    <ListItem divider disablePadding sx={{ py: 1, gap: 1 }}>
      <ListItemText
        primary={card.spanish}
        secondary={card.english}
        sx={{ overflowWrap: 'anywhere' }}
      />
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
  const [edit, setEdit] = useState<FlashCard | null>(null)
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
      setCards((current) => [...current, created])
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
            id="flash-card-spanish"
            label="Spanish"
            value={fields.spanish}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                spanish: event.target.value,
              }))
            }
            slotProps={{ htmlInput: { maxLength: 200 } }}
            required
            placeholder="e.g. el gato"
          />
          <TextField
            id="flash-card-english"
            label="English"
            value={fields.english}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                english: event.target.value,
              }))
            }
            slotProps={{ htmlInput: { maxLength: 200 } }}
            required
            placeholder="e.g. the cat"
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
                  setEdit(card)
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
        )}
      </Paper>
    </Stack>
  )
}

export default FlashCardsPage
