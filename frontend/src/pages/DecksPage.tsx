import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
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
import { Link } from 'react-router'
import { createDeck, deleteDeck, listDecks, updateDeck } from '../api/decks'
import type { Deck, DeckFields } from '../api/decks'
import { describeFetchError, listFlashCards } from '../api/flashCards'
import type { FlashCard, Tag } from '../api/flashCards'
import { listTags } from '../api/tags'
import { trackEvent, trackException } from '../telemetry'

export const deckNameRequiredMessage = 'Deck name is required.'

// The most a deck name can be, as the API allows.
const deckNameMaxLength = 50

// The deck in the form: a new one when there's no id, or the one being edited.
type DeckForm = DeckFields & { id: number | null }

const emptyForm: DeckForm = { id: null, name: '', flashCardIds: [] }

// Decks in name order whatever their case, as the API sends them.
function sortDecks(decks: Deck[]) {
  return [...decks].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

function cardLabel(card: FlashCard) {
  return `${card.spanish} — ${card.english}`
}

function cardCount(count: number) {
  return count === 1 ? '1 card' : `${count} cards`
}

function DecksPage() {
  const [decks, setDecks] = useState<Deck[]>([])
  const [cards, setCards] = useState<FlashCard[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [form, setForm] = useState<DeckForm>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  // The deck being deleted, so its buttons can wait for the API.
  const [busyId, setBusyId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  // Loads everything once. The page starts out loading, and the other actions keep the decks up to date themselves.
  useEffect(() => {
    let cancelled = false
    Promise.all([listDecks(), listFlashCards(), listTags()])
      .then(([loadedDecks, loadedCards, loadedTags]) => {
        if (!cancelled) {
          setDecks(loadedDecks)
          setCards(loadedCards)
          setTags(loadedTags)
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

  const selectedCards = cards.filter((card) =>
    form.flashCardIds.includes(card.id),
  )
  // Only the tags on a card the deck doesn't have yet, since the others would add nothing.
  const addableTags = tags.filter((tag) =>
    cards.some(
      (card) =>
        !form.flashCardIds.includes(card.id) &&
        card.tags.some((cardTag) => cardTag.id === tag.id),
    ),
  )

  // Adds the cards that have the tag now. Cards tagged later aren't added to the deck.
  function addTaggedCards(tag: Tag) {
    const tagged = cards
      .filter((card) => card.tags.some((cardTag) => cardTag.id === tag.id))
      .map((card) => card.id)
    setForm((current) => ({
      ...current,
      flashCardIds: [...new Set([...current.flashCardIds, ...tagged])],
    }))
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = form.name.trim()
    if (!name) {
      setErrorMessage(deckNameRequiredMessage)
      return
    }

    setSubmitting(true)
    setErrorMessage('')

    try {
      const fields = { name, flashCardIds: form.flashCardIds }
      if (form.id === null) {
        const created = await createDeck(fields)
        trackEvent('DeckCreated')
        setDecks((current) => sortDecks([...current, created]))
      } else {
        const updated = await updateDeck(form.id, fields)
        trackEvent('DeckUpdated')
        setDecks((current) =>
          sortDecks(
            current.map((deck) => (deck.id === updated.id ? updated : deck)),
          ),
        )
      }
      setForm(emptyForm)
    } catch (error) {
      trackException(error, {
        operation: form.id === null ? 'create' : 'update',
      })
      setErrorMessage(describeFetchError(error, 'Unable to save deck.'))
    } finally {
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
      if (form.id === deck.id) {
        setForm(emptyForm)
      }
    } catch (error) {
      trackException(error, { operation: 'delete' })
      setErrorMessage(describeFetchError(error, 'Unable to delete deck.'))
    } finally {
      setBusyId(null)
    }
  }

  const editing = form.id !== null

  return (
    <Stack spacing={2}>
      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          {editing ? 'Edit deck' : 'New deck'}
        </Typography>
        <Box
          component="form"
          onSubmit={(event) => void handleSubmit(event)}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            id="deck-name"
            label="Deck name"
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            inputRef={nameRef}
            slotProps={{ htmlInput: { maxLength: deckNameMaxLength } }}
            required
            placeholder="e.g. Week 1"
          />
          <Autocomplete
            multiple
            filterSelectedOptions
            options={cards}
            value={selectedCards}
            getOptionLabel={cardLabel}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            onChange={(_event, picked) =>
              setForm((current) => ({
                ...current,
                flashCardIds: picked.map((card) => card.id),
              }))
            }
            noOptionsText="No more cards"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Cards"
                placeholder={
                  selectedCards.length === 0 ? 'Pick cards' : undefined
                }
              />
            )}
          />
          {addableTags.length > 0 && (
            <Box
              role="group"
              aria-labelledby="deck-add-tagged-label"
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 1,
              }}
            >
              <Typography
                id="deck-add-tagged-label"
                variant="body2"
                color="text.secondary"
              >
                Add the cards tagged
              </Typography>
              {addableTags.map((tag) => (
                <Button
                  key={tag.id}
                  size="small"
                  variant="outlined"
                  onClick={() => addTaggedCards(tag)}
                >
                  {tag.name}
                </Button>
              ))}
            </Box>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? 'Saving…' : editing ? 'Save deck' : 'Create deck'}
            </Button>
            {editing && (
              <Button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setErrorMessage('')
                  setForm(emptyForm)
                }}
              >
                Cancel
              </Button>
            )}
          </Stack>
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
                  primary={deck.name}
                  secondary={cardCount(deck.flashCardIds.length)}
                  sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                />
                <Box sx={{ display: 'flex', flexShrink: 0 }}>
                  <Button
                    component={Link}
                    to={`/practice?deck=${deck.id}`}
                    aria-label={`Practice deck "${deck.name}"`}
                  >
                    Practice
                  </Button>
                  <Button
                    aria-label={`Edit deck "${deck.name}"`}
                    disabled={busyId === deck.id}
                    onClick={() => {
                      setErrorMessage('')
                      setForm({
                        id: deck.id,
                        name: deck.name,
                        flashCardIds: deck.flashCardIds,
                      })
                      // The form is above the list, so this takes keyboard and screen reader users to it.
                      nameRef.current?.focus()
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    color="error"
                    aria-label={`Delete deck "${deck.name}"`}
                    disabled={busyId === deck.id}
                    onClick={() => void handleDelete(deck)}
                  >
                    Delete
                  </Button>
                </Box>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Stack>
  )
}

export default DecksPage
