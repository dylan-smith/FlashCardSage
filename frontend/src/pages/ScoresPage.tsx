import { useEffect, useState } from 'react'
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
import { Link } from 'react-router'
import { formatWords, listFlashCardScores } from '../api/flashCards'
import { describeFetchError } from '../api/client'
import type { FlashCardScores } from '../api/flashCards'
import { useCardSelection } from '../hooks/useCardSelection'
import type { CardSelectionKind } from '../hooks/useCardSelection'
import { trackException } from '../telemetry'
import { CardSelectionPicker } from '../components/cards/CardSelectionPicker'
import { matchesSearch } from '../lib/cardSearch'

const emptyMessages: Record<CardSelectionKind, string> = {
  all: 'There are no flash cards to score yet.',
  deck: 'There are no cards in this deck.',
  tag: 'There are no cards with this tag.',
}

// A light shade from red at 0 to green at 100, pale enough that the text on it stays readable.
function scoreColor(score: number) {
  const hue = (Math.min(Math.max(score, 0), 100) / 100) * 120
  return `hsl(${hue}, 70%, 90%)`
}

function Loading() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
      <CircularProgress aria-label="Loading" />
    </Box>
  )
}

function ScoresPage() {
  const { choices, deck, tag, kind, value, waiting, select } =
    useCardSelection()
  // Kept here, so it still applies when another deck or tag is picked.
  const [search, setSearch] = useState('')

  return (
    <Stack spacing={2}>
      <CardSelectionPicker
        label="Cards"
        choices={choices}
        value={value}
        onSelect={select}
      />
      {waiting ? (
        <Paper component="section" elevation={2} sx={{ p: 3 }}>
          <Loading />
        </Paper>
      ) : (
        // Loaded again for each choice.
        <SelectionScores
          key={value}
          kind={kind}
          deckId={deck?.id}
          tagId={tag?.id}
          search={search}
          onSearchChange={setSearch}
        />
      )}
    </Stack>
  )
}

type SelectionScoresProps = {
  kind: CardSelectionKind
  deckId?: number
  tagId?: number
  search: string
  onSearchChange: (search: string) => void
}

function SelectionScores({
  kind,
  deckId,
  tagId,
  search,
  onSearchChange,
}: SelectionScoresProps) {
  const [scores, setScores] = useState<FlashCardScores | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  // Loaded each time the page is opened, so it includes the latest practice.
  useEffect(() => {
    let cancelled = false
    listFlashCardScores({ deckId, tagId })
      .then((loaded) => {
        if (!cancelled) {
          setScores(loaded)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trackException(error, { operation: 'scores' })
          setErrorMessage(describeFetchError(error, 'Unable to load scores.'))
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
  }, [deckId, tagId])

  // The total stays the score of every card picked, whatever the search shows.
  const matching =
    scores?.cards.filter((card) => matchesSearch(card, search)) ?? []

  return (
    <Stack spacing={2}>
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        {loading ? (
          <Loading />
        ) : scores === null ? null : scores.cards.length === 0 ? (
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Typography color="text.secondary">
              {emptyMessages[kind]}
            </Typography>
            {kind === 'deck' ? (
              <Button component={Link} to="/decks" variant="contained">
                Edit decks
              </Button>
            ) : (
              <Button component={Link} to="/" variant="contained">
                {kind === 'tag' ? 'Manage cards' : 'Add flash cards'}
              </Button>
            )}
          </Stack>
        ) : (
          <>
            <Typography variant="h6" component="p" sx={{ mb: 1 }}>
              {`Total score ${scores.total} / ${scores.maximum} (${Math.round((scores.total / scores.maximum) * 100)}%)`}
            </Typography>
            <TextField
              label="Search"
              type="search"
              size="small"
              fullWidth
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              sx={{ mb: 2 }}
            />
            {matching.length === 0 ? (
              <Typography color="text.secondary">No cards match.</Typography>
            ) : (
              <List disablePadding aria-label="Card scores">
                {matching.map((card) => (
                  <ListItem
                    key={card.id}
                    divider
                    disablePadding
                    sx={{ py: 1, px: 2, bgcolor: scoreColor(card.score) }}
                  >
                    <ListItemText
                      primary={formatWords(card.spanish)}
                      secondary={formatWords(card.english)}
                      slotProps={{ primary: { lang: 'es' } }}
                      sx={{ overflowWrap: 'anywhere' }}
                    />
                    <Typography sx={{ flexShrink: 0, ml: 2 }}>
                      {card.score} / 100
                    </Typography>
                  </ListItem>
                ))}
              </List>
            )}
          </>
        )}
      </Paper>
    </Stack>
  )
}

export default ScoresPage
