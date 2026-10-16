import { useEffect, useState, useSyncExternalStore } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { listFlashCards } from '../../api/flashCards'
import { useCandidateImport } from '../../hooks/useCandidateImport'
import {
  clearPreplyHandoff,
  getPreplyHandoff,
  subscribePreplyHandoff,
} from '../../preply/preplyHandoff'
import { groupWords } from '../../preply/groupWords'
import type { PreplyHandoff } from '../../preply/preplyHandoff'
import type { PreplyWord } from '../../preply/sendToFlashCardSage'
import { trackException } from '../../telemetry'
import { useLoad } from '../../hooks/useLoad'
import { showToast } from '../../toasts'
import type { Toast } from '../../toasts'
import { CardCandidates } from '../cards/CardCandidates'
import type { Candidate } from '../../lib/candidates'
import { cardCount } from '../../lib/cardCount'
import { PreplyBookmarklet } from './PreplyBookmarklet'

// The deck the user's Preply words go in, made the first time and added to after.
export const preplyDeckName = 'Preply'

// The words on the user's cards, by language and ignoring case, so the Preply words they already have are left out.
type Known = { spanish: Set<string>; english: Set<string> }

// The notices already shown for each lot of words, so coming back to the page doesn't show them again.
const announced = new WeakMap<PreplyHandoff, Set<string>>()

function announceOnce(handoff: PreplyHandoff, toast: Toast) {
  const keys = announced.get(handoff) ?? new Set<string>()
  if (keys.has(toast.key)) {
    return
  }
  keys.add(toast.key)
  announced.set(handoff, keys)
  showToast(toast)
}

// Preply's words as cards, with the words that share a Spanish or English word on one card.
function toCandidates(words: PreplyWord[]): Candidate[] {
  return groupWords(words).map(({ spanish, english }, key) => ({
    spanish,
    english,
    tags: [],
    key,
    picture: null,
  }))
}

function isKnown(
  known: Known,
  candidate: Pick<Candidate, 'spanish' | 'english'>,
) {
  return (
    candidate.spanish.some((word) => known.spanish.has(word.toLowerCase())) ||
    candidate.english.some((word) => known.english.has(word.toLowerCase()))
  )
}

// The Import cards page's Preply tab, where the "Send to FlashCardSage" bookmarklet brings the user's Preply
// vocabulary. The words are listed like the cards from a document, to look over, change or remove, and then add one at
// a time or all at once to the user's Preply deck. Words the user already has cards for are left out. Until the
// bookmarklet sends words, it says how to use it. Its notices wait until its tab is showing.
export function PreplyImport({ active }: { active: boolean }) {
  const handoff = useSyncExternalStore(subscribePreplyHandoff, getPreplyHandoff)
  // The lot of words the cards were made from.
  const [source, setSource] = useState<PreplyHandoff>(handoff)
  const [errorMessage, setErrorMessage] = useState('')

  const received = handoff.status === 'received'
  // The user's cards, once there are words to check against them. If they don't load, every word is listed, and the
  // API leaves out the ones the user has when they're added. They're kept when the words are cleared.
  const { data: known } = useLoad(
    async (): Promise<Known | null> => {
      const cards = await listFlashCards()
      const lower = (words: string[]) => words.map((word) => word.toLowerCase())
      return {
        spanish: new Set(cards.flatMap((card) => lower(card.spanish))),
        english: new Set(cards.flatMap((card) => lower(card.english))),
      }
    },
    [received],
    { operation: 'loadCards', initial: null, enabled: received },
  )
  // The words as cards, which the user changes and removes, made again whenever the bookmarklet sends words. Once
  // every word's been added or removed, they're forgotten, so a reload doesn't bring them back.
  const cards = useCandidateImport({
    deckName: preplyDeckName,
    toastKey: 'preply-added',
    events: {
      addedOne: 'PreplyCardAdded',
      addedAll: 'PreplyCardsAdded',
      countAll: true,
    },
    deckOperation: 'preplyDeck',
    hidden:
      known === null ? undefined : (candidate) => isKnown(known, candidate),
    initialCandidates: () =>
      handoff.status === 'received' ? toCandidates(handoff.words) : [],
    onFinish: clearPreplyHandoff,
  })
  if (handoff !== source) {
    setSource(handoff)
    if (handoff.status === 'received') {
      cards.setCandidates(toCandidates(handoff.words))
    }
  }
  const words = received ? handoff.words : []
  const { shown, addedCount } = cards
  // Whether there were any new words to add before the user added or removed some.
  const anyNew = toCandidates(words).some(
    (candidate) => known === null || !isKnown(known, candidate),
  )

  // Most likely Preply changed its API, which only shows up here.
  const failure = handoff.status === 'failed' ? handoff.message : null
  useEffect(() => {
    if (failure !== null) {
      trackException(new Error(failure), { operation: 'readPreply' })
    }
  }, [failure])

  // Says which words are left out, once, when they come.
  useEffect(() => {
    if (!active || handoff.status !== 'received') {
      return
    }
    const noEnglish = handoff.words.filter(
      (word) => word.english === null,
    ).length
    if (noEnglish > 0) {
      announceOnce(handoff, {
        key: 'preply-no-english',
        severity: 'info',
        message: `${noEnglish === 1 ? '1 word is' : `${noEnglish} words are`} left out because Preply has no English for ${noEnglish === 1 ? 'it' : 'them'}.`,
      })
    }
  }, [active, handoff])
  useEffect(() => {
    if (!active || handoff.status !== 'received' || known === null) {
      return
    }
    // Counted in Preply's words, though they're left out a card at a time.
    const alreadyHave = groupWords(handoff.words)
      .filter((group) => isKnown(known, group))
      .reduce((total, group) => total + group.wordCount, 0)
    if (alreadyHave > 0) {
      announceOnce(handoff, {
        key: 'preply-already-have',
        severity: 'info',
        message: `${alreadyHave === 1 ? '1 word is' : `${alreadyHave} words are`} left out because you already have ${alreadyHave === 1 ? 'a card' : 'cards'} for ${alreadyHave === 1 ? 'it' : 'them'}.`,
      })
    }
  }, [active, handoff, known])

  // Says how to try again when no words came.
  useEffect(() => {
    if (active && handoff.status === 'timedOut') {
      announceOnce(handoff, {
        key: 'preply-timed-out',
        severity: 'info',
        message:
          "No words came from Preply. To bring them in, click the bookmarklet on your Preply vocabulary page again. If you don't have it any more, drag it to your bookmarks bar from step 1 below.",
      })
    }
  }, [active, handoff])

  return (
    <Box>
      <Stack spacing={2}>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {cards.deckError && <Alert severity="error">{cards.deckError}</Alert>}
        {failure !== null && (
          <Alert severity="error">
            Your words couldn&apos;t be read from Preply. {failure}
          </Alert>
        )}

        {handoff.status === 'waiting' && (
          <Box>
            <Box
              role="status"
              sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}
            >
              <CircularProgress aria-hidden size={32} />
              <Typography>Getting your words from Preply…</Typography>
            </Box>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              This only takes a few seconds. If nothing comes, click the
              bookmarklet on your Preply vocabulary page again.
            </Typography>
            {/* The way back to the steps, and the bookmarklet, without waiting it out. */}
            <Button
              type="button"
              onClick={clearPreplyHandoff}
              sx={{ mt: 1, ml: -1 }}
            >
              Stop waiting
            </Button>
          </Box>
        )}

        {received && (
          <>
            <Typography color="text.secondary">
              These are the words in your Preply vocabulary. You can change or
              remove them before you add them to your {preplyDeckName} deck, one
              at a time or all at once. Words you already have cards for are
              left out.
            </Typography>
            <Typography variant="h6" component="h2">
              {`${cardCount(shown.length)} from Preply`}
            </Typography>
            {shown.length === 0 ? (
              <Typography color="text.secondary">
                {addedCount > 0
                  ? `You added ${cardCount(addedCount)} and removed the rest.`
                  : anyNew
                    ? 'You removed all the cards.'
                    : "There aren't any new words in your Preply vocabulary."}
              </Typography>
            ) : (
              <CardCandidates
                label="Cards from Preply"
                {...cards.listProps}
                onError={setErrorMessage}
              />
            )}
          </>
        )}

        {(handoff.status === 'none' ||
          handoff.status === 'failed' ||
          handoff.status === 'timedOut') && <PreplyBookmarklet />}
      </Stack>
    </Box>
  )
}
