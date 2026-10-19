import { useState } from 'react'
import Alert from '@mui/material/Alert'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { formatWords, listFlashCardScores } from '../api/flashCards'
import type { FlashCardScore, FlashCardScores } from '../api/flashCards'
import type { CardSelectionKind } from '../hooks/useCardSelection'
import { useLoad } from '../hooks/useLoad'
import { EmptyText } from '../components/common/EmptyText'
import { Loading } from '../components/common/Loading'
import { Section } from '../components/common/Section'
import { CardSelectionPage } from '../components/cards/CardSelectionPage'
import { EmptySelection } from '../components/cards/EmptySelection'
import { matchesSearch } from '../lib/cardSearch'

// A light shade from red at 0 to green at 100, pale enough that the text on it stays readable.
function scoreColor(score: number) {
  const hue = (Math.min(Math.max(score, 0), 100) / 100) * 120
  return `hsl(${hue}, 70%, 90%)`
}

// How many times the card was practiced, and how each one went.
function practiceSummary({ gotIt, wasClose, failed }: FlashCardScore) {
  const practiced = gotIt + wasClose + failed
  if (practiced === 0) {
    return 'Never practiced'
  }
  return `Practiced ${practiced} ${practiced === 1 ? 'time' : 'times'}: ${gotIt} got it, ${wasClose} close, ${failed} failed`
}

// When the card was last practiced, in the viewer's own locale and time zone.
function formatPracticedAt(practicedAt: string) {
  return new Date(practicedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function ScoresPage() {
  // Kept here, so it still applies when another deck or tag is picked.
  const [search, setSearch] = useState('')

  return (
    // Loaded again for each choice.
    <CardSelectionPage label="Cards">
      {(selection) => (
        <SelectionScores
          {...selection}
          search={search}
          onSearchChange={setSearch}
        />
      )}
    </CardSelectionPage>
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
  // Loaded each time the page is opened, so it includes the latest practice.
  const {
    data: scores,
    loading,
    error: errorMessage,
  } = useLoad(
    (): Promise<FlashCardScores | null> =>
      listFlashCardScores({ deckId, tagId }),
    [deckId, tagId],
    { operation: 'scores', fallback: 'Unable to load scores.', initial: null },
  )

  // The total stays the score of every card picked, whatever the search shows.
  const matching =
    scores?.cards.filter((card) => matchesSearch(card, search)) ?? []

  return (
    <Stack spacing={2}>
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      <Section>
        {loading ? (
          <Loading />
        ) : scores === null ? null : scores.cards.length === 0 ? (
          <EmptySelection
            kind={kind}
            noCardsMessage="There are no flash cards to score yet."
          />
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
              <EmptyText>No cards match.</EmptyText>
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
                    {/* Left out on phones, where there's no room beside the words. */}
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        display: { xs: 'none', sm: 'block' },
                        flexShrink: 0,
                        ml: 2,
                        textAlign: 'right',
                      }}
                    >
                      {practiceSummary(card)}
                      {card.lastPracticedAt && (
                        <>
                          <br />
                          {`Last ${formatPracticedAt(card.lastPracticedAt)}`}
                        </>
                      )}
                    </Typography>
                    <Typography sx={{ flexShrink: 0, ml: 2 }}>
                      {card.score} / 100
                    </Typography>
                  </ListItem>
                ))}
              </List>
            )}
          </>
        )}
      </Section>
    </Stack>
  )
}

export default ScoresPage
