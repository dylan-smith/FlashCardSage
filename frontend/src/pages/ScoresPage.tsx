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
import Typography from '@mui/material/Typography'
import { Link } from 'react-router'
import { describeFetchError, listFlashCardScores } from '../api/flashCards'
import type { FlashCardScores } from '../api/flashCards'
import { trackException } from '../telemetry'

// A light shade from red at 0 to green at 100, pale enough that the text on it stays readable.
function scoreColor(score: number) {
  const hue = (Math.min(Math.max(score, 0), 100) / 100) * 120
  return `hsl(${hue}, 70%, 90%)`
}

function ScoresPage() {
  const [scores, setScores] = useState<FlashCardScores | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  // Loaded each time the page is opened, so it includes the latest practice.
  useEffect(() => {
    let cancelled = false
    listFlashCardScores()
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
  }, [])

  return (
    <Stack spacing={2}>
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading" />
          </Box>
        ) : scores === null ? null : scores.cards.length === 0 ? (
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Typography color="text.secondary">
              There are no flash cards to score yet.
            </Typography>
            <Button component={Link} to="/" variant="contained">
              Add flash cards
            </Button>
          </Stack>
        ) : (
          <>
            <Typography variant="h6" component="p" sx={{ mb: 1 }}>
              {`Total score ${scores.total} / ${scores.maximum} (${Math.round((scores.total / scores.maximum) * 100)}%)`}
            </Typography>
            <List disablePadding aria-label="Card scores">
              {scores.cards.map((card) => (
                <ListItem
                  key={card.id}
                  divider
                  disablePadding
                  sx={{ py: 1, px: 2, bgcolor: scoreColor(card.score) }}
                >
                  <ListItemText
                    primary={card.spanish}
                    secondary={card.english}
                    slotProps={{ primary: { lang: 'es' } }}
                    sx={{ overflowWrap: 'anywhere' }}
                  />
                  <Typography sx={{ flexShrink: 0, ml: 2 }}>
                    {card.score} / 100
                  </Typography>
                </ListItem>
              ))}
            </List>
          </>
        )}
      </Paper>
    </Stack>
  )
}

export default ScoresPage
