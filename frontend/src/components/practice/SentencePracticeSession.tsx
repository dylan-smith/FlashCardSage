import { useEffect, useEffectEvent, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { describeFetchError } from '../../api/client'
import { formatWords } from '../../api/flashCards'
import type { PracticeOutcome, PracticeSide } from '../../api/flashCards'
import {
  getPracticeSentences,
  minSentenceCards,
  sendSentenceResult,
} from '../../api/sentencePractice'
import type { PracticeSentence } from '../../api/sentencePractice'
import { getSession, sessionSubject } from '../../auth/session'
import { useAction } from '../../hooks/useAction'
import type { CardSelectionKind } from '../../hooks/useCardSelection'
import { useLoad } from '../../hooks/useLoad'
import { useOnline } from '../../practice/online'
import { loadPracticePack, selectCards } from '../../practice/pack'
import { loadSpeech } from '../../practice/speech'
import { trackEvent, trackException } from '../../telemetry'
import { EmptySelection } from '../cards/EmptySelection'
import { EmptyText } from '../common/EmptyText'
import { Loading } from '../common/Loading'
import { CardSide } from './CardSide'
import { ListenButton } from './ListenButton'
import { ListeningDescription, ListeningSwitch } from './ListeningSwitch'
import { OutcomeButtons } from './OutcomeButtons'
import { sides } from './sides'

const noCardsMessage = 'There are no flash cards to make sentences from yet.'

// Who has too few cards, in "Sentences need at least 3 cards, and you have 2."
const tooFewOwners: Record<CardSelectionKind, string> = {
  all: 'you have',
  deck: 'this deck has',
  tag: 'this tag has',
}

// A sentence to practice, and the side shown first, picked at random as it arrives.
type QueuedSentence = { sentence: PracticeSentence; side: PracticeSide }

// Spanish or English, as likely as each other.
function rollSide(): PracticeSide {
  return Math.random() < 0.5 ? 'Spanish' : 'English'
}

// Whether more sentences can be asked for: yes until the API says they aren't available, a request fails, or it had
// none to give. Try again asks again after either of the last two.
type FetchStatus = 'idle' | 'unavailable' | 'failed' | 'exhausted'

// More are asked for once only this many are left after the one showing, so the next is usually there at once.
const prefetchWhenLeft = 2

// Practices sentences gpt-5-mini writes from the selection's cards, a handful at a time, so the user meets their words
// in context. Like a card, each shows one side, Spanish or English at random, then both and the cards it uses once
// it's revealed. The answers are kept to learn from and don't change the cards' scores. The sentences are written as
// they're needed, so unlike cards this needs a connection. Listening mode works as it does for cards.
export function SentencePracticeSession({
  kind,
  deckId,
  tagId,
  listening,
  onListeningChange,
}: {
  kind: CardSelectionKind
  deckId?: number
  tagId?: number
  listening: boolean
  onListeningChange: (on: boolean) => void
}) {
  const [errorMessage, setErrorMessage] = useState('')
  // Whose cards on the device these are. The session can't change while the page is open, since signing out leaves it.
  const [subject] = useState(() => sessionSubject(getSession()!))
  // The selection's cards, to know whether there are enough for sentences and to show the ones a sentence uses (the
  // API only sends their ids).
  const { data: cards, loading } = useLoad(
    async (signal) => {
      const pack = await loadPracticePack(subject, signal)
      return pack === null ? null : selectCards(pack, { deckId, tagId })
    },
    [deckId, tagId],
    {
      operation: 'load',
      fallback: 'Unable to load flash cards.',
      onError: setErrorMessage,
      initial: null,
    },
  )
  // The sentences to practice, the first of them the one showing.
  const [queue, setQueue] = useState<QueuedSentence[]>([])
  const current = queue.length > 0 ? queue[0] : null
  const [status, setStatus] = useState<FetchStatus>('idle')
  const [revealed, setRevealed] = useState(false)
  // How many sentences have been answered since the page was opened.
  const [practiced, setPracticed] = useState(0)
  const saving = useAction(setErrorMessage)
  const online = useOnline()
  // In listening mode every sentence starts with its Spanish, heard rather than seen until it's revealed, whichever
  // side was picked for it. The side picked is kept for when listening mode is off.
  const listeningNow = listening && online
  const shownSide: PracticeSide | null =
    current === null ? null : listeningNow ? 'Spanish' : current.side
  // The request for more sentences on its way, so there's only ever one.
  const requestRef = useRef<AbortController | null>(null)
  // The button that replaces the one just pressed gets focus, so keyboard users can carry on from where they were.
  const revealRef = useRef<HTMLButtonElement>(null)
  const firstOutcomeRef = useRef<HTMLButtonElement>(null)
  const answeredRef = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const enoughCards = cards !== null && cards.length >= minSentenceCards
  const needsMore =
    online &&
    enoughCards &&
    status === 'idle' &&
    queue.length <= prefetchWhenLeft + 1

  const fetchMore = useEffectEvent(() => {
    if (requestRef.current !== null) {
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    getPracticeSentences({ deckId, tagId }, controller.signal)
      .then((sentences) => {
        if (controller.signal.aborted) {
          return
        }
        requestRef.current = null
        if (sentences === null) {
          setStatus('unavailable')
        } else if (sentences.length === 0) {
          setStatus('exhausted')
        } else {
          setQueue((items) => [
            ...items,
            ...sentences.map((sentence) => ({ sentence, side: rollSide() })),
          ])
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        requestRef.current = null
        trackException(error, { operation: 'sentences' })
        setErrorMessage(describeFetchError(error, 'Unable to make sentences.'))
        setStatus('failed')
      })
  })

  // Asks for more whenever they're running low, again after a handful that still leaves too few, and not while
  // offline, which keeps the ones already here for when the user is back.
  useEffect(() => {
    if (needsMore) {
      fetchMore()
    }
  }, [needsMore, queue.length])

  // A request still on its way when the session closes is dropped.
  useEffect(
    () => () => {
      requestRef.current?.abort()
      requestRef.current = null
    },
    [],
  )

  // Asks for the sentence's audio as soon as it comes up, whichever side is showing, so Listen plays at once. A
  // failure is left for the button to show, when the user presses it.
  useEffect(() => {
    if (current !== null && online) {
      loadSpeech([current.sentence.spanish]).catch(() => {})
    }
  }, [current, online])

  useEffect(() => {
    if (revealed) {
      firstOutcomeRef.current?.focus({ preventScroll: true })
      cardRef.current?.scrollIntoView({ block: 'nearest' })
    } else if (answeredRef.current) {
      revealRef.current?.focus()
    }
  }, [revealed, current])

  async function handleAnswer(outcome: PracticeOutcome) {
    if (current === null || shownSide === null) {
      return
    }
    const { sentence } = current
    const side = shownSide
    await saving.run(
      {
        operation: 'sentencePractice',
        fallback: 'Unable to save your answer.',
        reportAll: true,
      },
      async () => {
        await sendSentenceResult({
          spanish: sentence.spanish,
          english: sentence.english,
          cardIds: sentence.cardIds,
          shownSide: side,
          listening: listeningNow,
          outcome,
        })
        trackEvent('SentencePracticeResultRecorded', {
          outcome,
          shownSide: side,
          listening: String(listeningNow),
        })
        answeredRef.current = true
        setPracticed((count) => count + 1)
        setQueue((items) => items.slice(1))
        setRevealed(false)
      },
    )
  }

  function tryAgain() {
    setErrorMessage('')
    setStatus('idle')
  }

  // The side's sentence, with Listen beside the Spanish. In listening mode the Spanish plays as the sentence comes up,
  // and until it's revealed there's only a bigger Listen in place of its words. It's the same button once revealed, so
  // the audio carries on if it's still playing. A new button for each sentence, so one's playing never carries over to
  // the next. In listening mode there's Listen slowly beside it too.
  function sentenceSide({ sentence }: QueuedSentence, side: PracticeSide) {
    const heardOnly = listeningNow && side === 'Spanish' && !revealed
    return (
      <CardSide
        side={side}
        text={heardOnly ? undefined : sentence[sides[side].field]}
        variant="h5"
        action={
          side === 'Spanish' ? (
            <ListenButton
              key={sentence.spanish}
              texts={[sentence.spanish]}
              onError={setErrorMessage}
              autoPlay={listeningNow}
              large={heardOnly}
              withSlow={listeningNow}
            />
          ) : undefined
        }
      />
    )
  }

  // The cards the sentence uses that are on the device, in the order the API gave them.
  function cardsUsed({ sentence }: QueuedSentence) {
    const byId = new Map((cards ?? []).map((card) => [card.id, card]))
    return sentence.cardIds.flatMap((id) => byId.get(id) ?? [])
  }

  function body() {
    if (loading) {
      return <Loading />
    }
    if (!online) {
      return (
        <EmptyText>
          Sentences need a connection, since they&apos;re written for you as you
          go. Switch to Cards to practice offline.
        </EmptyText>
      )
    }
    if (cards === null) {
      return errorMessage ? null : (
        <EmptyText>
          Your cards aren&apos;t on this device yet. Open Practice once while
          you&apos;re online, and you can practice offline after that.
        </EmptyText>
      )
    }
    if (cards.length === 0) {
      return <EmptySelection kind={kind} noCardsMessage={noCardsMessage} />
    }
    if (!enoughCards) {
      return (
        <EmptySelection
          kind={kind}
          noCardsMessage={noCardsMessage}
          message={`Sentences need at least ${minSentenceCards} cards, and ${tooFewOwners[kind]} ${cards.length}.`}
        />
      )
    }
    if (current === null || shownSide === null) {
      switch (status) {
        case 'unavailable':
          return <EmptyText>Sentences aren&apos;t available.</EmptyText>
        case 'failed':
          return (
            <Box>
              <Button type="button" variant="contained" onClick={tryAgain}>
                Try again
              </Button>
            </Box>
          )
        case 'exhausted':
          return (
            <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
              <EmptyText>
                Couldn&apos;t make any sentences from these cards right now.
              </EmptyText>
              <Button type="button" variant="contained" onClick={tryAgain}>
                Try again
              </Button>
            </Stack>
          )
        default:
          return <Loading />
      }
    }

    const otherSide: PracticeSide =
      shownSide === 'Spanish' ? 'English' : 'Spanish'
    const used = cardsUsed(current)
    return (
      <Stack spacing={{ xs: 2, sm: 3 }}>
        <Stack
          spacing={2}
          aria-live="polite"
          sx={{ textAlign: 'center', py: { xs: 0, sm: 2 } }}
        >
          {sentenceSide(current, shownSide)}
          {revealed && (
            <>
              <Divider />
              {sentenceSide(current, otherSide)}
              {used.length > 0 && (
                <Box>
                  <Typography
                    variant="overline"
                    component="p"
                    color="text.secondary"
                  >
                    Uses
                  </Typography>
                  <Box
                    component="ul"
                    aria-label="Cards used"
                    sx={{
                      listStyle: 'none',
                      p: 0,
                      m: 0,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 1,
                      justifyContent: 'center',
                    }}
                  >
                    {used.map((card) => (
                      <Chip
                        key={card.id}
                        component="li"
                        label={formatWords(card.spanish)}
                        lang="es"
                      />
                    ))}
                  </Box>
                </Box>
              )}
            </>
          )}
        </Stack>
        {revealed ? (
          <OutcomeButtons
            firstRef={firstOutcomeRef}
            disabled={saving.busy}
            onAnswer={(outcome) => void handleAnswer(outcome)}
          />
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
    )
  }

  return (
    <Stack spacing={2}>
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      {/* Kept outside the card, since they're about the session rather than this sentence. */}
      {current !== null && online && (
        <Box>
          <Typography variant="body2" color="text.secondary">
            Sentences written from your cards, to practice your words in
            context.
          </Typography>
          <Stack
            direction="row"
            spacing={2}
            sx={{ justifyContent: 'space-between', alignItems: 'center' }}
          >
            <ListeningSwitch
              listening={listening}
              onChange={onListeningChange}
            />
            <Typography
              color="text.secondary"
              sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}
            >
              Sentences practiced{' '}
              <Box
                component="span"
                sx={{ fontWeight: 'bold', color: 'text.primary' }}
              >
                {practiced}
              </Box>
            </Typography>
          </Stack>
          <ListeningDescription listening={listening} online={online} />
        </Box>
      )}

      <Paper
        ref={cardRef}
        component="section"
        elevation={2}
        sx={{
          p: { xs: 2, sm: 3 },
          maxHeight: 'calc(100dvh - 32px)',
          overflowY: 'auto',
          scrollMarginBlock: '16px',
        }}
      >
        {body()}
      </Paper>
    </Stack>
  )
}
