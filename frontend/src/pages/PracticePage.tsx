import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link } from 'react-router'
import {
  describeFetchError,
  listFlashCardScores,
  maximumScore,
  recordPracticeResult,
} from '../api/flashCards'
import type { FlashCardScore, PracticeOutcome } from '../api/flashCards'
import { trackEvent, trackException } from '../telemetry'

type Side = 'spanish' | 'english'

// The card being practiced and the side the user is shown first.
type Prompt = {
  card: FlashCardScore
  side: Side
}

const sides: Record<Side, { label: string; lang: string }> = {
  spanish: { label: 'Spanish', lang: 'es' },
  english: { label: 'English', lang: 'en' },
}

const outcomes: {
  outcome: PracticeOutcome
  label: string
  color: 'success' | 'primary' | 'error'
}[] = [
  { outcome: 'GotIt', label: 'Got it!', color: 'success' },
  { outcome: 'WasClose', label: 'I was close', color: 'primary' },
  { outcome: 'Failed', label: 'Failed :(', color: 'error' },
]

const dayInMilliseconds = 24 * 60 * 60 * 1000

// How likely a card is to come up, up to the maximum score for a card never practiced. The lower its score, the
// likelier it is, and it gains a little for every day since it was last practiced, so even a card with the
// maximum score comes back now and then.
function weight(card: FlashCardScore, now: number) {
  const days =
    card.lastPracticedAt === null
      ? 0
      : Math.max(0, now - Date.parse(card.lastPracticedAt)) / dayInMilliseconds
  return Math.min(maximumScore, maximumScore - card.score + days)
}

// A card picked by its weight, and a random side. The card just practiced isn't picked again straight away, unless
// it's the only one. When every card has no weight, they're all as likely as each other.
function pickPrompt(
  cards: FlashCardScore[],
  previous?: FlashCardScore,
): Prompt {
  const choices =
    cards.length > 1 ? cards.filter((card) => card.id !== previous?.id) : cards
  const now = Date.now()
  const weights = choices.map((card) => weight(card, now))
  const total = weights.reduce((sum, value) => sum + value, 0)
  const chances = total > 0 ? weights : choices.map(() => 1)
  let target = Math.random() * (total > 0 ? total : choices.length)
  // Falls back to the last card that can be picked, in case rounding leaves the target past the end.
  let index = chances.findLastIndex((chance) => chance > 0)
  for (const [position, chance] of chances.entries()) {
    target -= chance
    if (target < 0) {
      index = position
      break
    }
  }
  return {
    card: choices[index],
    side: Math.random() < 0.5 ? 'spanish' : 'english',
  }
}

function CardSide({ side, text }: { side: Side; text: string }) {
  return (
    <Box>
      <Typography variant="overline" component="p" color="text.secondary">
        {sides[side].label}
      </Typography>
      <Typography
        variant="h4"
        component="p"
        lang={sides[side].lang}
        sx={{ overflowWrap: 'anywhere' }}
      >
        {text}
      </Typography>
    </Box>
  )
}

function PracticePage() {
  const [cards, setCards] = useState<FlashCardScore[]>([])
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  // The button that replaces the one just pressed gets focus, so keyboard users can carry on from where they were.
  const revealRef = useRef<HTMLButtonElement>(null)
  const firstOutcomeRef = useRef<HTMLButtonElement>(null)
  const answeredRef = useRef(false)

  // Loads the cards and their scores once. Each answer returns the card's new score, so they're never reloaded.
  useEffect(() => {
    let cancelled = false
    listFlashCardScores()
      .then(({ cards: loaded }) => {
        if (!cancelled) {
          setCards(loaded)
          setPrompt(loaded.length > 0 ? pickPrompt(loaded) : null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trackException(error, { operation: 'load' })
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

  useEffect(() => {
    if (revealed) {
      firstOutcomeRef.current?.focus()
    } else if (answeredRef.current) {
      revealRef.current?.focus()
    }
  }, [revealed, prompt])

  async function handleAnswer(outcome: PracticeOutcome) {
    if (prompt === null) {
      return
    }

    setSaving(true)
    setErrorMessage('')

    try {
      const { score, practicedAt } = await recordPracticeResult(
        prompt.card.id,
        outcome,
      )
      trackEvent('PracticeResultRecorded', { outcome })
      answeredRef.current = true
      const updated = cards.map((card) =>
        card.id === prompt.card.id
          ? { ...card, score, lastPracticedAt: practicedAt }
          : card,
      )
      setCards(updated)
      setPrompt(pickPrompt(updated, prompt.card))
      setRevealed(false)
    } catch (error) {
      trackException(error, { operation: 'practice' })
      setErrorMessage(describeFetchError(error, 'Unable to save your answer.'))
    } finally {
      setSaving(false)
    }
  }

  const otherSide: Side = prompt?.side === 'spanish' ? 'english' : 'spanish'

  return (
    <Stack spacing={2}>
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading" />
          </Box>
        ) : prompt === null ? (
          errorMessage ? null : (
            <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
              <Typography color="text.secondary">
                There are no flash cards to practice yet.
              </Typography>
              <Button component={Link} to="/" variant="contained">
                Add flash cards
              </Button>
            </Stack>
          )
        ) : (
          <Stack spacing={3}>
            <Stack
              spacing={2}
              aria-live="polite"
              sx={{ textAlign: 'center', py: 2 }}
            >
              <CardSide side={prompt.side} text={prompt.card[prompt.side]} />
              {revealed && (
                <>
                  <Divider />
                  <CardSide side={otherSide} text={prompt.card[otherSide]} />
                </>
              )}
            </Stack>
            {revealed ? (
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ justifyContent: 'center' }}
              >
                {outcomes.map(({ outcome, label, color }, index) => (
                  <Button
                    key={outcome}
                    ref={index === 0 ? firstOutcomeRef : undefined}
                    type="button"
                    variant="contained"
                    color={color}
                    disabled={saving}
                    onClick={() => void handleAnswer(outcome)}
                  >
                    {label}
                  </Button>
                ))}
              </Stack>
            ) : (
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Button
                  ref={revealRef}
                  type="button"
                  variant="contained"
                  onClick={() => setRevealed(true)}
                >
                  Reveal
                </Button>
              </Box>
            )}
          </Stack>
        )}
      </Paper>
    </Stack>
  )
}

export default PracticePage
