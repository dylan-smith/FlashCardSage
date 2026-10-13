import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { listCardSuggestions } from '../api/cardSuggestions'
import type { CardSuggestion } from '../api/cardSuggestions'
import type { FlashCardWords } from '../api/flashCards'
import { trackException } from '../telemetry'

type SuggestionsState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed' }
  | { status: 'ready'; suggestions: CardSuggestion[] }

function sameText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

// A handful of new cards suggested from the user's cards, each with a button that adds it. The section isn't shown
// when suggestions aren't available, and a suggestion the user has since added a card for is left out.
export function CardSuggestions({
  cards,
  onAdd,
}: {
  cards: FlashCardWords[]
  onAdd: (suggestion: CardSuggestion) => Promise<boolean>
}) {
  const [state, setState] = useState<SuggestionsState>({ status: 'loading' })
  // Bumped to ask for a fresh handful.
  const [request, setRequest] = useState(0)
  // The suggestion being added, so its button can wait for the API.
  const [adding, setAdding] = useState<CardSuggestion | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listCardSuggestions(controller.signal)
      .then((suggestions) => {
        setState(
          suggestions === null
            ? { status: 'unavailable' }
            : { status: 'ready', suggestions },
        )
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          trackException(error, { operation: 'suggest' })
          setState({ status: 'failed' })
        }
      })
    return () => {
      controller.abort()
    }
  }, [request])

  function refresh() {
    setState({ status: 'loading' })
    setRequest((current) => current + 1)
  }

  async function add(suggestion: CardSuggestion) {
    setAdding(suggestion)
    try {
      if (await onAdd(suggestion)) {
        setState((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                suggestions: current.suggestions.filter(
                  (item) => item !== suggestion,
                ),
              }
            : current,
        )
      }
    } finally {
      setAdding(null)
    }
  }

  if (state.status === 'unavailable') {
    return null
  }

  const visible =
    state.status === 'ready'
      ? state.suggestions.filter(
          (suggestion) =>
            !cards.some(
              (card) =>
                sameText(card.spanish, suggestion.spanish) ||
                sameText(card.english, suggestion.english),
            ),
        )
      : []

  return (
    <Paper component="section" elevation={2} sx={{ p: 3 }}>
      <Typography variant="h5" component="h2">
        Suggested cards
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1 }}>
        New words and phrases that go with your cards.
      </Typography>
      {state.status === 'loading' ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress aria-label="Loading suggestions" />
        </Box>
      ) : state.status === 'failed' ? (
        <Typography color="text.secondary">
          Unable to suggest cards right now.
        </Typography>
      ) : visible.length === 0 ? (
        <Typography color="text.secondary">
          No suggestions right now.
        </Typography>
      ) : (
        <List disablePadding aria-label="Suggested cards">
          {visible.map((suggestion) => (
            <ListItem
              key={`${suggestion.spanish}\n${suggestion.english}`}
              divider
              disablePadding
              sx={{ py: 1, gap: 1 }}
            >
              <ListItemText
                primary={suggestion.spanish}
                secondary={suggestion.english}
                sx={{ overflowWrap: 'anywhere' }}
              />
              <Button
                type="button"
                size="small"
                disabled={adding !== null}
                aria-label={`Add "${suggestion.spanish}"`}
                onClick={() => void add(suggestion)}
                sx={{ flexShrink: 0 }}
              >
                {adding === suggestion ? 'Adding…' : 'Add'}
              </Button>
            </ListItem>
          ))}
        </List>
      )}
      <Button
        type="button"
        size="small"
        disabled={state.status === 'loading' || adding !== null}
        onClick={refresh}
        sx={{ mt: 1 }}
      >
        {state.status === 'failed' ? 'Try again' : 'More suggestions'}
      </Button>
    </Paper>
  )
}
