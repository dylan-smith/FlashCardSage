import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import SvgIcon from '@mui/material/SvgIcon'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { describeFetchError } from '../api/client'
import { formatWords } from '../api/flashCards'
import type {
  PracticeCard,
  PracticeOutcome,
  PracticeSelection,
  PracticeSide,
} from '../api/flashCards'
import type { PackCard, PracticePack } from '../api/practice'
import { getSession, sessionSubject } from '../auth/session'
import type { CardSelectionKind } from '../hooks/useCardSelection'
import { usePreferences } from '../hooks/usePreferences'
import { icons } from '../lib/icons'
import { readJson, writeJson } from '../lib/localJson'
import { storageKeys } from '../lib/storageKeys'
import { reportFailure } from '../lib/reportFailure'
import { trackEvent } from '../telemetry'
import { useAction } from '../hooks/useAction'
import { useLoad } from '../hooks/useLoad'
import { useOnline } from '../practice/online'
import {
  loadPracticePack,
  selectCards,
  withPendingAnswers,
} from '../practice/pack'
import { pick } from '../practice/picker'
import { enqueueResult, readQueue } from '../practice/queue'
import { applyAnswer } from '../practice/score'
import { loadSpeech, playFailedMessage, playSpeech } from '../practice/speech'
import type { Playback } from '../practice/speech'
import { syncPracticeResults, useSyncStatus } from '../practice/sync'
import { Loading } from '../components/common/Loading'
import { EmptyText } from '../components/common/EmptyText'
import { CardSelectionPage } from '../components/cards/CardSelectionPage'
import { EmptySelection } from '../components/cards/EmptySelection'

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

// The selection's cards, as they'll be once the answers on the device are saved, and the card being practiced (null
// when there are none).
type PracticeState = { cards: PackCard[]; prompt: PracticeCard | null }

// Picks the next card, never the one just practiced unless it's the only one.
function pickNext(cards: PackCard[], previousId: number | null) {
  // The card is rolled for first, then its side.
  const cardRoll = Math.random()
  const sideRoll = Math.random()
  return pick(cards, previousId, new Date(), cardRoll, sideRoll)
}

// What to practice from the pack, or null when there's no pack on the device and the API can't be reached.
function toPracticeState(
  pack: PracticePack | null,
  subject: string,
  selection: PracticeSelection,
): PracticeState | null {
  if (pack === null) {
    return null
  }
  const cards = selectCards(
    withPendingAnswers(pack, readQueue(subject)),
    selection,
  )
  return { cards, prompt: pickNext(cards, null) }
}

// "1 answer" or "2 answers".
function formatAnswers(count: number) {
  return count === 1 ? '1 answer' : `${count} answers`
}

// Says when the answers given can't be saved yet, or nothing when they're saved as they're given.
function SyncNote() {
  const online = useOnline()
  const { pending, failed } = useSyncStatus()
  const note = !online
    ? pending === 0
      ? "Offline – your answers will be saved when you're back online."
      : `Offline – ${formatAnswers(pending)} will be saved when you're back online.`
    : failed && pending > 0
      ? `${formatAnswers(pending)} couldn't be saved yet. They'll be saved when FlashCardSage can be reached.`
      : ''
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      role="status"
      sx={{ textAlign: 'right' }}
    >
      {note}
    </Typography>
  )
}

// One side of the card: its words, unless they're to be heard rather than seen, with a button beside them when the
// side has one (Listen, for the Spanish).
function CardSide({
  side,
  text,
  action,
}: {
  side: PracticeSide
  text?: string
  action?: ReactNode
}) {
  return (
    <Box>
      <Typography variant="overline" component="p" color="text.secondary">
        {side}
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'center' }}
      >
        {text !== undefined && (
          <Typography
            variant="h4"
            component="p"
            lang={sides[side].lang}
            sx={{ overflowWrap: 'anywhere', minWidth: 0 }}
          >
            {text}
          </Typography>
        )}
        {action}
      </Stack>
    </Box>
  )
}

// Whether the browser refused to play audio the user didn't ask for, as it does before they've pressed anything on
// the page.
function isAutoplayRefused(error: unknown) {
  return error instanceof DOMException && error.name === 'NotAllowedError'
}

// Plays the card's Spanish: each word or phrase in turn, read by a natural voice. The audio is asked for as soon as
// the card comes up (see PracticeSession), so pressing Listen usually plays at once; while it's still being fetched
// the button shows a spinner, and while it plays the button stops it instead. With autoPlay it also plays as soon as
// it's shown, unless the browser won't let it, which needs no error since the user can press it. The audio comes from
// the API, so the button is off while the browser is offline.
function ListenButton({
  texts,
  onError,
  autoPlay = false,
  large = false,
}: {
  texts: string[]
  onError: (message: string) => void
  autoPlay?: boolean
  large?: boolean
}) {
  const online = useOnline()
  // A button that plays by itself starts out fetching the audio.
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>(() =>
    autoPlay && online ? 'loading' : 'idle',
  )
  const playbackRef = useRef<Playback | null>(null)
  // Counts each play and the button going away, so audio that arrives after either is never played.
  const runRef = useRef(0)

  // Whatever's playing stops with the card.
  useEffect(
    () => () => {
      runRef.current++
      playbackRef.current?.stop()
    },
    [],
  )

  async function play(automatic: boolean) {
    const run = ++runRef.current
    const current = () => runRef.current === run
    if (!automatic) {
      setState('loading')
    }
    try {
      const urls = await loadSpeech(texts)
      if (!current()) {
        return
      }
      const playback = playSpeech(urls)
      playbackRef.current = playback
      setState('playing')
      await playback.done
    } catch (error) {
      if (current() && !(automatic && isAutoplayRefused(error))) {
        reportFailure(error, 'speech')
        onError(describeFetchError(error, playFailedMessage))
      }
    } finally {
      if (current()) {
        playbackRef.current = null
        setState('idle')
      }
    }
  }

  // Once, when the card comes up.
  useEffect(() => {
    if (autoPlay && online) {
      // Its state only changes once the audio has arrived, since it starts out fetching it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void play(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleClick() {
    if (state === 'playing') {
      playbackRef.current?.stop()
    } else if (state === 'idle') {
      void play(false)
    }
  }

  const playing = state === 'playing'
  return (
    <IconButton
      color="primary"
      size={large ? 'large' : 'medium'}
      aria-label={playing ? 'Stop' : 'Listen'}
      aria-busy={state === 'loading'}
      disabled={!online}
      onClick={handleClick}
      sx={{ flexShrink: 0 }}
    >
      {state === 'loading' ? (
        <CircularProgress size={large ? 48 : 24} color="inherit" />
      ) : (
        <SvgIcon sx={large ? { fontSize: 48 } : undefined}>
          <path d={icons[playing ? 'stop' : 'volumeUp']} />
        </SvgIcon>
      )}
    </IconButton>
  )
}

// Whether practice is in listening mode, where every card starts with its Spanish heard rather than seen. Remembered
// in the browser, so it stays on across reloads.
function useListeningMode() {
  const [listening, setListening] = useState(
    () =>
      readJson(
        storageKeys.practiceListening,
        (value): value is boolean => typeof value === 'boolean',
      ) === true,
  )
  function change(on: boolean) {
    setListening(on)
    writeJson(storageKeys.practiceListening, on)
    trackEvent('PracticeListeningModeChanged', { on: String(on) })
  }
  return [listening, change] as const
}

function PracticePage() {
  // Kept here rather than in the session, so it stays as it is when the user picks other cards.
  const [listening, setListening] = useListeningMode()
  return (
    // A new session for each choice, so the session score starts again.
    <CardSelectionPage label="Practice">
      {(selection) => (
        <PracticeSession
          {...selection}
          listening={listening}
          onListeningChange={setListening}
        />
      )}
    </CardSelectionPage>
  )
}

type PracticeSessionProps = {
  kind: CardSelectionKind
  deckId?: number
  tagId?: number
  listening: boolean
  onListeningChange: (on: boolean) => void
}

function PracticeSession({
  kind,
  deckId,
  tagId,
  listening,
  onListeningChange,
}: PracticeSessionProps) {
  const [errorMessage, setErrorMessage] = useState('')
  // Whose cards and answers on the device these are. The session can't change while the page is open, since signing
  // out leaves it.
  const [subject] = useState(() => sessionSubject(getSession()!))
  // The cards being practiced and the card being practiced now, picked on the device so practice works offline. The
  // answers are kept on the device and saved to the API in the background (see practice/sync).
  const {
    data: practice,
    setData: setPractice,
    loading,
  } = useLoad(
    async (signal) =>
      toPracticeState(await loadPracticePack(subject, signal), subject, {
        deckId,
        tagId,
      }),
    [deckId, tagId],
    {
      operation: 'load',
      fallback: 'Unable to load flash cards.',
      onError: setErrorMessage,
      initial: null,
    },
  )
  const prompt = practice?.prompt ?? null
  const [revealed, setRevealed] = useState(false)
  const saving = useAction(setErrorMessage)
  // How much the answers given since the page was opened have raised or lowered the total score.
  const [sessionScore, setSessionScore] = useState(0)
  // The button that replaces the one just pressed gets focus, so keyboard users can carry on from where they were.
  const revealRef = useRef<HTMLButtonElement>(null)
  const firstOutcomeRef = useRef<HTMLButtonElement>(null)
  const answeredRef = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const showPictures = usePreferences()?.showPictures === true
  const online = useOnline()

  // Asks for the card's audio as soon as it comes up, whichever side is showing, so Listen plays at once. A failure
  // is left for the button to show, when the user presses it.
  useEffect(() => {
    if (prompt !== null && online) {
      loadSpeech(prompt.spanish).catch(() => {})
    }
  }, [prompt, online])

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
    const card = practice?.cards.find((item) => item.id === prompt?.id)
    if (practice === null || card === undefined) {
      return
    }

    await saving.run(
      {
        operation: 'practice',
        fallback: 'Unable to save your answer.',
        reportAll: true,
      },
      () => {
        const practicedAt = new Date().toISOString()
        const answered = applyAnswer(card, outcome, practicedAt)
        // Throws when the answer can't be kept, so the card stays to be answered again.
        enqueueResult(subject, card.id, outcome, practicedAt)
        trackEvent('PracticeResultRecorded', { outcome })
        answeredRef.current = true
        setSessionScore((score) => score + answered.score - card.score)
        const cards = practice.cards.map((item) =>
          item.id === card.id ? answered : item,
        )
        setPractice({ cards, prompt: pickNext(cards, card.id) })
        setRevealed(false)
        void syncPracticeResults()
        return Promise.resolve()
      },
    )
  }

  // In listening mode every card starts with its Spanish, heard rather than seen until it's revealed. The audio comes
  // from the API, so while offline the cards show their words, on the side picked for them, as they do without it.
  const listeningNow = listening && online
  const promptSide: PracticeSide = listeningNow
    ? 'Spanish'
    : (prompt?.side ?? 'Spanish')
  const otherSide: PracticeSide =
    promptSide === 'Spanish' ? 'English' : 'Spanish'

  // The side's words, with Listen beside the Spanish. In listening mode the Spanish plays as the card comes up, and
  // until the card is revealed there's only a bigger Listen in place of its words. It's the same button once revealed,
  // so the audio carries on if it's still playing. A new button for each card, so one card's playing never carries
  // over to the next, and each card plays by itself once.
  function cardSide(side: PracticeSide) {
    if (prompt === null) {
      return null
    }
    const heardOnly = listeningNow && side === 'Spanish' && !revealed
    return (
      <CardSide
        side={side}
        text={heardOnly ? undefined : formatWords(prompt[sides[side].field])}
        action={
          side === 'Spanish' ? (
            <ListenButton
              key={prompt.id}
              texts={prompt.spanish}
              onError={setErrorMessage}
              autoPlay={listeningNow}
              large={heardOnly}
            />
          ) : undefined
        }
      />
    )
  }

  return (
    <Stack spacing={2}>
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      {/* Kept outside the card, since they're about the session rather than this card. */}
      {prompt !== null && (
        <Box>
          <Stack
            direction="row"
            spacing={2}
            sx={{ justifyContent: 'space-between', alignItems: 'center' }}
          >
            <FormControlLabel
              label="Listening mode"
              control={
                <Switch
                  checked={listening}
                  onChange={(event) => onListeningChange(event.target.checked)}
                  slotProps={{
                    input: { 'aria-describedby': 'listening-description' },
                  }}
                />
              }
            />
            <Typography
              color="text.secondary"
              sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}
            >
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
          </Stack>
          <Typography
            id="listening-description"
            variant="body2"
            color="text.secondary"
          >
            {listening && !online
              ? "Listening mode is off while you're offline."
              : 'Hear the Spanish before you see it.'}
          </Typography>
          <SyncNote />
        </Box>
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
          <Loading />
        ) : practice === null ? (
          errorMessage ? null : (
            <EmptyText>
              Your cards aren&apos;t on this device yet. Open Practice once
              while you&apos;re online, and you can practice offline after that.
            </EmptyText>
          )
        ) : prompt === null ? (
          errorMessage ? null : (
            <EmptySelection
              kind={kind}
              noCardsMessage="There are no flash cards to practice yet."
            />
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
                {cardSide(promptSide)}
                {revealed && (
                  <>
                    <Divider />
                    {cardSide(otherSide)}
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
                    disabled={saving.busy}
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
