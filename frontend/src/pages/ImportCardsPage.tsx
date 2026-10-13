import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router'
import { describeFetchError } from '../api/flashCards'
import { importSystemDeck, listSystemDecks } from '../api/systemDecks'
import type { SystemDeck, SystemDeckImport } from '../api/systemDecks'
import { trackEvent, trackException } from '../telemetry'
import { cardCount } from './cardCount'
import { FlashCardRow } from './FlashCardRow'

// The deck's tags, each once, in name order.
function deckTags(deck: SystemDeck) {
  return [
    ...new Set(deck.cards.flatMap((card) => card.tags.map((tag) => tag.name))),
  ].sort((a, b) => a.localeCompare(b))
}

// What importing did, such as "Added Months with 12 cards." and how many were left out.
function describeImport({ deck, skippedCount }: SystemDeckImport) {
  const added = `Added ${deck.name} with ${cardCount(deck.flashCardIds.length)}.`
  if (skippedCount === 0) {
    return added
  }
  return `${added} ${skippedCount === 1 ? '1 card was' : `${skippedCount} cards were`} left out because you already have ${skippedCount === 1 ? 'it' : 'them'}.`
}

// The built-in decks the user can add to their own. Adding one copies its cards and tags, so the user can change them
// like any of their cards.
function ImportCardsPage() {
  const [decks, setDecks] = useState<SystemDeck[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  // The decks whose cards are showing.
  const [shownIds, setShownIds] = useState<number[]>([])
  // The deck being added, so its button can wait for the API.
  const [busyId, setBusyId] = useState<number | null>(null)
  const [imported, setImported] = useState<SystemDeckImport | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    listSystemDecks()
      .then((loaded) => {
        if (!cancelled) {
          setDecks(loaded)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trackException(error, { operation: 'load' })
          setLoadFailed(true)
          setErrorMessage(
            describeFetchError(error, 'Unable to load the built-in decks.'),
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

  function toggleShown(id: number) {
    setShownIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )
  }

  async function handleImport(deck: SystemDeck) {
    setBusyId(deck.id)
    setImported(null)
    setErrorMessage('')

    try {
      const result = await importSystemDeck(deck.id)
      trackEvent('SystemDeckImported')
      setImported(result)
    } catch (error) {
      trackException(error, { operation: 'import' })
      setErrorMessage(describeFetchError(error, 'Unable to add the deck.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Stack spacing={2}>
      {imported && (
        <Alert
          severity="success"
          action={
            <Button
              component={RouterLink}
              to={`/decks/${imported.deck.id}`}
              color="inherit"
              size="small"
            >
              Open deck
            </Button>
          }
        >
          {describeImport(imported)}
        </Alert>
      )}
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
          Built-in decks
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Add a deck to get its cards and tags. They&apos;re then yours to
          change. Cards you already have are left out.
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading" />
          </Box>
        ) : loadFailed ? null : decks.length === 0 ? (
          <Typography color="text.secondary">
            There aren&apos;t any built-in decks yet.
          </Typography>
        ) : (
          <List disablePadding>
            {decks.map((deck) => {
              const shown = shownIds.includes(deck.id)
              const cardsId = `system-deck-${deck.id}-cards`
              const tags = deckTags(deck)
              return (
                <ListItem
                  key={deck.id}
                  divider
                  disablePadding
                  sx={{ py: 1, display: 'block' }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {/* The name shows and hides the deck's cards, with an arrow like the suggested cards' heading. */}
                    <ListItemText
                      primary={
                        <Button
                          type="button"
                          color="inherit"
                          aria-expanded={shown}
                          aria-controls={cardsId}
                          onClick={() => toggleShown(deck.id)}
                          endIcon={
                            <SvgIcon
                              sx={{
                                transform: shown ? 'none' : 'rotate(-90deg)',
                                transition: 'transform 150ms',
                              }}
                            >
                              <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                            </SvgIcon>
                          }
                          sx={{
                            font: 'inherit',
                            textTransform: 'none',
                            textAlign: 'left',
                            ml: -1,
                            px: 1,
                            py: 0,
                          }}
                        >
                          {deck.name}
                        </Button>
                      }
                      secondary={[cardCount(deck.cards.length), ...tags].join(
                        ' · ',
                      )}
                      sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                    />
                    <Button
                      variant="contained"
                      aria-label={`Add deck "${deck.name}"`}
                      disabled={busyId !== null}
                      onClick={() => void handleImport(deck)}
                      sx={{ flexShrink: 0 }}
                    >
                      {busyId === deck.id ? 'Adding…' : 'Add'}
                    </Button>
                  </Box>
                  <Collapse in={shown} id={cardsId} unmountOnExit>
                    {/* Laid out like the user's own cards, set in a little under the deck. */}
                    <List
                      disablePadding
                      aria-label={`Cards in "${deck.name}"`}
                      // The deck's own divider is under the last card.
                      sx={{
                        pl: 2,
                        '& > li:last-of-type': { borderBottom: 'none' },
                      }}
                    >
                      {deck.cards.map((card) => (
                        <FlashCardRow key={card.id} card={card} />
                      ))}
                    </List>
                  </Collapse>
                </ListItem>
              )
            })}
          </List>
        )}
      </Paper>
    </Stack>
  )
}

export default ImportCardsPage
