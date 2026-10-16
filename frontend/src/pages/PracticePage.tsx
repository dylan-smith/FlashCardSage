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
  formatWords,
  getNextPracticeCard,
  recordPracticeResult,
} from '../api/flashCards'
import type {
  PracticeCard,
  PracticeOutcome,
  PracticeSide,
} from '../api/flashCards'
import { useCardSelection } from '../hooks/useCardSelection'
import type { CardSelectionKind } from '../hooks/useCardSelection'
import { usePreferences } from '../hooks/usePreferences'
import { trackEvent, trackException } from '../telemetry'
import { CardSelectionPicker } from '../components/cards/CardSelectionPicker'

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

const emptyMessages: Record<CardSelectionKind, string> = {
  all: 'There are no flash cards to practice yet.',
  deck: 'There are no cards in this deck.',
  tag: 'There are no cards with this tag.',
}

function PracticePage() {
  const { choices, deck, tag, kind, value, waiting, select } =
    useCardSelection()

  return (
    <Stack spacing={2}>
      <CardSelectionPicker
        label="Practice"
        choices={choices}
        value={value}
        onSelect={select}
      />
      {waiting ? (
        <Paper component="section" elevation={2} sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading" />
          </Box>
        </Paper>
      ) : (
        // A new session for each choice, so the session score starts again.
        <PracticeSession
          key={value}
          kind={kind}
          deckId={deck?.id}
          tagId={tag?.id}
        />
      )}
    </Stack>
  )
}

type PracticeSessionProps = {
  kind: CardSelectionKind
  deckId?: number
  tagId?: number
}

function PracticeSession({ kind, deckId, tagId }: PracticeSessionProps) {
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
  const cardRef = useRef<HTMLDivElement>(null)
  const showPictures = usePreferences()?.showPictures === true

  // The API picks the first card here, and each one after that when an answer is saved.
  useEffect(() => {
    let cancelled = false
    getNextPracticeCard({ deckId, tagId })
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
  }, [deckId, tagId])

  useEffect(() => {
    if (revealed) {
      // The whole revealed card fits on the screen, so bring all of it into view rather than just the button, and
      // the user never has to scroll to answer.
      firstOutcomeRef.current?.focus({ preventScroll: true })
      cardRef.current?.scrollIntoView({ block: 'nearest' })
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
        { deckId, tagId },
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

      {/* Kept outside the card, since it's about the session rather than this card. */}
      {prompt !== null && (
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
      )}

      {/* Never taller than the screen: the picture shrinks to fit, so the words, picture and buttons are all on it at
          once. */}
      <Paper
        ref={cardRef}
        component="section"
        elevation={2}
        sx={{
          p: { xs: 2, sm: 3 },
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100dvh - 32px)',
          overflowY: 'auto',
          scrollMarginBlock: '16px',
        }}
      >
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading" />
          </Box>
        ) : prompt === null ? (
          errorMessage ? null : (
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
          )
        ) : (
          <Stack spacing={{ xs: 2, sm: 3 }} sx={{ minHeight: 0 }}>
            {/* The picture sits to the left of the text, or below it on a narrow screen. The row is reversed so the
                text still comes first for screen readers. */}
            <Stack
              direction={{ xs: 'column', sm: 'row-reverse' }}
              spacing={{ xs: 2, sm: 3 }}
              aria-live="polite"
              sx={{ alignItems: 'center', py: { xs: 0, sm: 2 }, minHeight: 0 }}
            >
              <Stack
                spacing={2}
                sx={{
                  textAlign: 'center',
                  flex: { xs: 'none', sm: 1 },
                  minWidth: 0,
                  width: '100%',
                }}
              >
                <CardSide
                  side={prompt.side}
                  text={formatWords(prompt[sides[prompt.side].field])}
                />
                {revealed && (
                  <>
                    <Divider />
                    <CardSide
                      side={otherSide}
                      text={formatWords(prompt[sides[otherSide].field])}
                    />
                  </>
                )}
              </Stack>
              {/* Only once revealed, so the picture doesn't give the answer away. */}
              {revealed && showPictures && prompt.imageUrl !== null && (
                <Box
                  component="img"
                  src={prompt.imageUrl}
                  alt={`Picture for "${formatWords(prompt.spanish)}"`}
                  // Up to 240px square, and smaller when that's all the room the card has left.
                  sx={{
                    flex: { xs: '0 1 240px', sm: 'none' },
                    width: 'auto',
                    height: { sm: 240 },
                    minHeight: 0,
                    maxWidth: '100%',
                    maxHeight: { sm: '100%' },
                    aspectRatio: '1',
                    objectFit: 'cover',
                    borderRadius: 1,
                  }}
                />
              )}
            </Stack>
            {revealed ? (
              // In a row even on a phone, where they share its width, so they take up less of the screen's height.
              <Stack
                direction="row"
                spacing={1}
                sx={{ justifyContent: 'center', flexShrink: 0 }}
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
                    sx={{ flex: { xs: 1, sm: 'none' } }}
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
