import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { addToNamedDeck } from '../../api/decks'
import {
  createFlashCard,
  createFlashCards,
  formatWords,
  listFlashCards,
} from '../../api/flashCards'
import type { FlashCardBatch, FlashCardFields } from '../../api/flashCards'
import { useUserTags } from '../../hooks/useUserTags'
import {
  clearPreplyHandoff,
  getPreplyHandoff,
  subscribePreplyHandoff,
} from '../../preply/preplyHandoff'
import { groupWords } from '../../preply/groupWords'
import type { PreplyHandoff } from '../../preply/preplyHandoff'
import type { PreplyWord } from '../../preply/sendToFlashCardSage'
import { trackEvent, trackException } from '../../telemetry'
import { useLoad } from '../../hooks/useLoad'
import { showToast } from '../../toasts'
import type { Toast } from '../../toasts'
import { CardCandidates } from '../cards/CardCandidates'
import type { Adding, Candidate } from '../cards/CardCandidates'
import { cardCount } from '../../lib/cardCount'
import { PreplyBookmarklet } from './PreplyBookmarklet'

// The deck the user's Preply words go in, made the first time and added to after.
export const preplyDeckName = 'Preply'

// As many cards as the API adds in one request (FlashCardBatchRequest.MaxCards), so a longer vocabulary is added a
// part at a time.
const batchSize = 100

// The words on the user's cards, by language and ignoring case, so the Preply words they already have are left out.
type Known = { spanish: Set<string>; english: Set<string> }

// The toast for the cards just added, one at a time or all at once, so each replaces the last.
const preplyAddedToast = 'preply-added'

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

// What adding the cards did: how many went in, one at a time or all at once, and how many were left out.
type Added = { count: number; skippedCount: number }

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

function describeAdded({ count, skippedCount }: Added) {
  const added = `Added ${cardCount(count)} to your ${preplyDeckName} deck.`
  if (skippedCount === 0) {
    return added
  }
  return `${added} ${skippedCount === 1 ? '1 card was' : `${skippedCount} cards were`} left out because you already have ${skippedCount === 1 ? 'it' : 'them'}.`
}

// The Import cards page's Preply tab, where the "Send to FlashCardSage" bookmarklet brings the user's Preply
// vocabulary. The words are listed like the cards from a document, to look over, change or remove, and then add one at
// a time or all at once to the user's Preply deck. Words the user already has cards for are left out. Until the
// bookmarklet sends words, it says how to use it. Its notices wait until its tab is showing.
export function PreplyImport({ active }: { active: boolean }) {
  const handoff = useSyncExternalStore(subscribePreplyHandoff, getPreplyHandoff)
  // The words as cards, which the user changes and removes, made again whenever the bookmarklet sends words.
  const [source, setSource] = useState<PreplyHandoff>(handoff)
  const [candidates, setCandidates] = useState<Candidate[]>(() =>
    handoff.status === 'received' ? toCandidates(handoff.words) : [],
  )
  if (handoff !== source) {
    setSource(handoff)
    if (handoff.status === 'received') {
      setCandidates(toCandidates(handoff.words))
    }
  }
  const [adding, setAdding] = useState<Adding>(null)
  // How many the user has added one at a time.
  const [addedCount, setAddedCount] = useState(0)
  // The Preply deck the cards went in, for the toast's link once they're all added.
  const deckId = useRef<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [deckError, setDeckError] = useState('')
  const [tags, addNewTags] = useUserTags()

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
  const words = received ? handoff.words : []
  const shown =
    known === null
      ? candidates
      : candidates.filter((candidate) => !isKnown(known, candidate))
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

  // Puts the cards in the user's Preply deck, making it the first time. The cards are added whatever happens to the
  // deck, so a failure is only said.
  async function putInDeck(ids: number[]) {
    if (ids.length === 0) {
      return
    }
    try {
      const deck = await addToNamedDeck(preplyDeckName, ids)
      deckId.current = deck.id
    } catch (error) {
      trackException(error, { operation: 'preplyDeck' })
      setDeckError(
        `The cards were added, but couldn't be put in your ${preplyDeckName} deck.`,
      )
    }
  }

  async function addOne(fields: FlashCardFields) {
    const card = await createFlashCard(fields)
    await putInDeck([card.id])
    return card
  }

  async function addAll(fields: FlashCardFields[]): Promise<FlashCardBatch> {
    const result: FlashCardBatch = { cards: [], skippedCount: 0 }
    for (let start = 0; start < fields.length; start += batchSize) {
      const part = await createFlashCards(
        fields.slice(start, start + batchSize),
      )
      result.cards.push(...part.cards)
      result.skippedCount += part.skippedCount
    }
    await putInDeck(result.cards.map((card) => card.id))
    return result
  }

  function handleAdding(value: Adding) {
    setAdding(value)
    if (value !== null) {
      setDeckError('')
    }
  }

  // Once every word's been added or removed, they're forgotten, so a reload doesn't bring them back.
  function finish(result: Added) {
    showToast({
      key: preplyAddedToast,
      severity: 'success',
      message: describeAdded(result),
      action:
        deckId.current === null
          ? undefined
          : { label: 'Open deck', to: `/decks/${deckId.current}` },
    })
    setAddedCount(0)
    setCandidates([])
    clearPreplyHandoff()
  }

  function handleAddedOne(candidate: Candidate) {
    trackEvent('PreplyCardAdded')
    const remaining = shown.filter((item) => item.key !== candidate.key)
    if (remaining.length === 0) {
      finish({ count: addedCount + 1, skippedCount: 0 })
    } else {
      showToast({
        key: preplyAddedToast,
        severity: 'success',
        message: `Added “${formatWords(candidate.spanish)}” to your ${preplyDeckName} deck.`,
      })
      setAddedCount(addedCount + 1)
      setCandidates((current) =>
        current.filter((item) => item.key !== candidate.key),
      )
    }
  }

  function handleAddedAll(result: FlashCardBatch) {
    trackEvent('PreplyCardsAdded', { count: String(result.cards.length) })
    finish({
      count: result.cards.length + addedCount,
      skippedCount: result.skippedCount,
    })
  }

  return (
    <Box>
      <Stack spacing={2}>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {deckError && <Alert severity="error">{deckError}</Alert>}
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
                candidates={shown}
                onCandidatesChange={setCandidates}
                tags={tags}
                onTagsAdded={addNewTags}
                adding={adding}
                onAddingChange={handleAdding}
                onError={setErrorMessage}
                addOne={addOne}
                addAll={addAll}
                onAddedOne={handleAddedOne}
                onAddedAll={handleAddedAll}
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
