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
  listFlashCards,
  recordPracticeResult,
} from '../api/flashCards'
import type { FlashCard, PracticeOutcome } from '../api/flashCards'
import { trackEvent, trackException } from '../telemetry'

type Side = 'spanish' | 'english'

// The card being practiced and the side the user is shown first.
type Prompt = {
  card: FlashCard
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

// A random card and side. The card just practiced isn't picked again straight away, unless it's the only one.
function pickPrompt(cards: FlashCard[], previous?: FlashCard): Prompt {
  const choices =
    cards.length > 1 ? cards.filter((card) => card.id !== previous?.id) : cards
  return {
    card: choices[Math.floor(Math.random() * choices.length)],
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
  const [cards, setCards] = useState<FlashCard[]>([])
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  // The button that replaces the one just pressed gets focus, so keyboard users can carry on from where they were.
  const revealRef = useRef<HTMLButtonElement>(null)
  const firstOutcomeRef = useRef<HTMLButtonElement>(null)
  const answeredRef = useRef(false)

  // Loads the cards once. Practicing doesn't change them, so they're never reloaded.
  useEffect(() => {
    let cancelled = false
    listFlashCards()
      .then((loaded) => {
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
      await recordPracticeResult(prompt.card.id, outcome)
      trackEvent('PracticeResultRecorded', { outcome })
      answeredRef.current = true
      setPrompt(pickPrompt(cards, prompt.card))
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
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          Practice
        </Typography>
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
