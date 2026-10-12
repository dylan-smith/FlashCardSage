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
  getNextPracticeCard,
  recordPracticeResult,
} from '../api/flashCards'
import type {
  PracticeCard,
  PracticeOutcome,
  PracticeSide,
} from '../api/flashCards'
import { trackEvent, trackException } from '../telemetry'

// Which field of a card holds each side, and its language.
const sides: Record<
  PracticeSide,
  { field: 'spanish' | 'english'; lang: string }
> = {
  Spanish: { field: 'spanish', lang: 'es' },
  English: { field: 'english', lang: 'en' },
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

// A rise in score gets a plus sign, so it reads as a change rather than a total.
function formatScoreChange(change: number) {
  return change > 0 ? `+${change}` : `${change}`
}

function CardSide({ side, text }: { side: PracticeSide; text: string }) {
  return (
    <Box>
      <Typography variant="overline" component="p" color="text.secondary">
        {side}
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
  // The card being practiced, as the API picked it.
  const [prompt, setPrompt] = useState<PracticeCard | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // How much the answers given since the page was opened have raised or lowered the total score.
  const [sessionScore, setSessionScore] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  // The button that replaces the one just pressed gets focus, so keyboard users can carry on from where they were.
  const revealRef = useRef<HTMLButtonElement>(null)
  const firstOutcomeRef = useRef<HTMLButtonElement>(null)
  const answeredRef = useRef(false)

  // The API picks the first card here, and each one after that when an answer is saved.
  useEffect(() => {
    let cancelled = false
    getNextPracticeCard()
      .then((next) => {
        if (!cancelled) {
          setPrompt(next)
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
      const { next, scoreChange } = await recordPracticeResult(
        prompt.id,
        outcome,
      )
      trackEvent('PracticeResultRecorded', { outcome })
      answeredRef.current = true
      setSessionScore((score) => score + scoreChange)
      setPrompt(next)
      setRevealed(false)
    } catch (error) {
      trackException(error, { operation: 'practice' })
      setErrorMessage(describeFetchError(error, 'Unable to save your answer.'))
    } finally {
      setSaving(false)
    }
  }

  const otherSide: PracticeSide =
    prompt?.side === 'Spanish' ? 'English' : 'Spanish'

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
            <Typography color="text.secondary" sx={{ textAlign: 'right' }}>
              Session score{' '}
              <Box
                component="span"
                sx={{
                  fontWeight: 'bold',
                  color:
                    sessionScore > 0
                      ? 'success.main'
                      : sessionScore < 0
                        ? 'error.main'
                        : 'text.primary',
                }}
              >
                {formatScoreChange(sessionScore)}
              </Box>
            </Typography>
            <Stack
              spacing={2}
              aria-live="polite"
              sx={{ textAlign: 'center', py: 2 }}
            >
              <CardSide
                side={prompt.side}
                text={prompt[sides[prompt.side].field]}
              />
              {revealed && (
                <>
                  <Divider />
                  <CardSide
                    side={otherSide}
                    text={prompt[sides[otherSide].field]}
                  />
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
