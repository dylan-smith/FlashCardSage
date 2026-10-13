import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link, useSearchParams } from 'react-router'
import { listDecks } from '../api/decks'
import type { Deck } from '../api/decks'
import {
  describeFetchError,
  getNextPracticeCard,
  recordPracticeResult,
} from '../api/flashCards'
import type {
  PracticeCard,
  PracticeOutcome,
  PracticeSide,
  Tag,
} from '../api/flashCards'
import { listTags } from '../api/tags'
import { usePreferences } from '../hooks/usePreferences'
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

// What's being practiced: every card, a deck's or a tag's.
type PracticeKind = 'all' | 'deck' | 'tag'

const emptyMessages: Record<PracticeKind, string> = {
  all: 'There are no flash cards to practice yet.',
  deck: 'There are no cards in this deck.',
  tag: 'There are no cards with this tag.',
}

// The user's decks and tags, to pick which cards to practice.
type PracticeChoices = { decks: Deck[]; tags: Tag[] }

function PracticePage() {
  // The deck or tag being practiced is in the URL, so the back button and a refresh keep it. One that doesn't exist
  // (any more) practices every card.
  const [searchParams, setSearchParams] = useSearchParams()
  const deckParam = searchParams.get('deck')
  const tagParam = searchParams.get('tag')
  // Null until they've loaded.
  const [choices, setChoices] = useState<PracticeChoices | null>(null)
  const [choicesFailed, setChoicesFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([listDecks(), listTags()])
      .then(([decks, tags]) => {
        if (!cancelled) {
          setChoices({ decks, tags })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trackException(error, { operation: 'loadChoices' })
          setChoicesFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const deck =
    choices?.decks.find((item) => String(item.id) === deckParam) ?? null
  const tag =
    deck === null
      ? (choices?.tags.find((item) => String(item.id) === tagParam) ?? null)
      : null
  const kind: PracticeKind = deck ? 'deck' : tag ? 'tag' : 'all'
  const value = deck ? `deck-${deck.id}` : tag ? `tag-${tag.id}` : 'all'
  // A deck or tag in the URL can only be practiced once it's known to be the user's.
  const waiting =
    choices === null &&
    !choicesFailed &&
    (deckParam !== null || tagParam !== null)

  function handleSelect(selected: string) {
    const [type, id] = selected.split('-')
    setSearchParams(
      type === 'deck' ? { deck: id } : type === 'tag' ? { tag: id } : {},
    )
  }

  return (
    <Stack spacing={2}>
      {choices !== null &&
        (choices.decks.length > 0 || choices.tags.length > 0) && (
          // Each option says whether it's a deck or a tag. MUI's Select makes every child an option, so group
          // headings would be read out as options too.
          <TextField
            select
            label="Practice"
            size="small"
            value={value}
            onChange={(event) => handleSelect(event.target.value)}
            sx={{ minWidth: 220, alignSelf: 'flex-start' }}
          >
            <MenuItem value="all">All cards</MenuItem>
            {choices.decks.map((item) => (
              <MenuItem key={`deck-${item.id}`} value={`deck-${item.id}`}>
                Deck: {item.name}
              </MenuItem>
            ))}
            {choices.tags.map((item) => (
              <MenuItem key={`tag-${item.id}`} value={`tag-${item.id}`}>
                Tag: {item.name}
              </MenuItem>
            ))}
          </TextField>
        )}
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
  kind: PracticeKind
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

      <Paper component="section" elevation={2} sx={{ p: 3 }}>
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
          <Stack spacing={3}>
            {/* The picture sits to the left of the text, or below it on a narrow screen. The row is reversed so the
                text still comes first for screen readers. */}
            <Stack
              direction={{ xs: 'column', sm: 'row-reverse' }}
              spacing={3}
              aria-live="polite"
              sx={{ alignItems: 'center', py: 2 }}
            >
              <Stack
                spacing={2}
                sx={{
                  textAlign: 'center',
                  flex: 1,
                  minWidth: 0,
                  width: '100%',
                }}
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
              {/* Only once revealed, so the picture doesn't give the answer away. */}
              {revealed && showPictures && prompt.imageUrl !== null && (
                <Box
                  component="img"
                  src={prompt.imageUrl}
                  alt={`Picture for "${prompt.spanish}"`}
                  sx={{
                    width: 240,
                    maxWidth: '100%',
                    height: 240,
                    flexShrink: 0,
                    objectFit: 'cover',
                    borderRadius: 1,
                  }}
                />
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
