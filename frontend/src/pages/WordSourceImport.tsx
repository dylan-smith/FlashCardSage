import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { addToNamedDeck } from '../api/decks'
import {
  createFlashCard,
  createFlashCards,
  formatWords,
  listFlashCards,
} from '../api/flashCards'
import type { FlashCardBatch, FlashCardFields } from '../api/flashCards'
import { useUserTags } from '../hooks/useUserTags'
import { trackEvent, trackException } from '../telemetry'
import { showToast } from '../toasts'
import type { Toast } from '../toasts'
import {
  clearHandoff,
  getHandoff,
  subscribeHandoff,
} from '../wordSources/handoff'
import type { Handoff } from '../wordSources/handoff'
import type { SourceWord, WordSource } from '../wordSources/wordSources'
import { BookmarkletSteps } from './BookmarkletSteps'
import { CardCandidates } from './CardCandidates'
import type { Adding, Candidate } from './CardCandidates'
import { cardCount } from './cardCount'

// As many cards as the API adds in one request (FlashCardBatchRequest.MaxCards), so a longer list is added a part at
// a time.
const batchSize = 100

// The words on the user's cards, by language and ignoring case, so the site's words they already have are left out.
type Known = { spanish: Set<string>; english: Set<string> }

// What this tab's panel sees when the bookmarklet that sent something, or is being waited for, is another site's.
const noHandoff: Handoff = { status: 'none' }

// The notices already shown for each lot of words, so coming back to the page doesn't show them again.
const announced = new WeakMap<Handoff, Set<string>>()

function announceOnce(handoff: Handoff, toast: Toast) {
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

function toCandidates(source: WordSource, words: SourceWord[]): Candidate[] {
  return source.toGroups(words).map(({ spanish, english }, key) => ({
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

function wordsAre(count: number) {
  return count === 1 ? '1 word is' : `${count} words are`
}

// The Import cards page's tab for a site the user learns on, where its "Send to FlashCardSage" bookmarklet brings the
// user's words. The words are listed like the cards from a document, to look over, change or remove, and then add one
// at a time or all at once to the user's deck for the site. Words the user already has cards for are left out. Until
// the bookmarklet sends words, it says how to use it. Its notices wait until its tab is showing.
export function WordSourceImport({
  source,
  active,
}: {
  source: WordSource
  active: boolean
}) {
  const { name: deckName } = source
  const everyHandoff = useSyncExternalStore(subscribeHandoff, getHandoff)
  // Only this site's words. Another site's tab is waiting for, or has, its own.
  const handoff =
    everyHandoff.status !== 'none' && everyHandoff.source === source.id
      ? everyHandoff
      : noHandoff
  // The words as cards, which the user changes and removes, made again whenever the bookmarklet sends words.
  const [shownFor, setShownFor] = useState<Handoff>(handoff)
  const [candidates, setCandidates] = useState<Candidate[]>(() =>
    handoff.status === 'received' ? toCandidates(source, handoff.words) : [],
  )
  if (handoff !== shownFor) {
    setShownFor(handoff)
    if (handoff.status === 'received') {
      setCandidates(toCandidates(source, handoff.words))
    }
  }
  const [known, setKnown] = useState<Known | null>(null)
  const [adding, setAdding] = useState<Adding>(null)
  // How many the user has added one at a time.
  const [addedCount, setAddedCount] = useState(0)
  // The deck the cards went in, for the toast's link once they're all added.
  const deckId = useRef<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [deckError, setDeckError] = useState('')
  const [tags, addNewTags] = useUserTags()

  const received = handoff.status === 'received'
  const words = received ? handoff.words : []
  const shown =
    known === null
      ? candidates
      : candidates.filter((candidate) => !isKnown(known, candidate))
  // Whether there were any new words to add before the user added or removed some.
  const anyNew = toCandidates(source, words).some(
    (candidate) => known === null || !isKnown(known, candidate),
  )

  // Most likely the site changed its API, which only shows up here.
  const failure = handoff.status === 'failed' ? handoff.message : null
  useEffect(() => {
    if (failure !== null) {
      trackException(new Error(failure), { operation: `read${source.name}` })
    }
  }, [failure, source.name])

  // Says which words are left out, once, when they come: the ones the site has no English for, and the ones whose
  // English is all on other cards here (which only Duolingo's words can be).
  useEffect(() => {
    if (!active || handoff.status !== 'received') {
      return
    }
    const noEnglish = handoff.words.filter(
      (word) => word.english.length === 0,
    ).length
    if (noEnglish > 0) {
      announceOnce(handoff, {
        key: `${source.id}-no-english`,
        severity: 'info',
        message: `${wordsAre(noEnglish)} left out because ${source.name} has no English for ${noEnglish === 1 ? 'it' : 'them'}.`,
      })
    }
    const onCards = source
      .toGroups(handoff.words)
      .reduce((total, group) => total + group.wordCount, 0)
    const englishTaken = handoff.words.length - noEnglish - onCards
    if (englishTaken > 0) {
      announceOnce(handoff, {
        key: `${source.id}-english-taken`,
        severity: 'info',
        message: `${wordsAre(englishTaken)} left out because ${englishTaken === 1 ? 'its' : 'their'} English is on other cards here.`,
      })
    }
  }, [active, handoff, source])
  useEffect(() => {
    if (!active || handoff.status !== 'received' || known === null) {
      return
    }
    // Counted in the site's words, though they're left out a card at a time.
    const alreadyHave = source
      .toGroups(handoff.words)
      .filter((group) => isKnown(known, group))
      .reduce((total, group) => total + group.wordCount, 0)
    if (alreadyHave > 0) {
      announceOnce(handoff, {
        key: `${source.id}-already-have`,
        severity: 'info',
        message: `${wordsAre(alreadyHave)} left out because you already have ${alreadyHave === 1 ? 'a card' : 'cards'} for ${alreadyHave === 1 ? 'it' : 'them'}.`,
      })
    }
  }, [active, handoff, known, source])

  // Says how to try again when no words came.
  useEffect(() => {
    if (active && handoff.status === 'timedOut') {
      announceOnce(handoff, {
        key: `${source.id}-timed-out`,
        severity: 'info',
        message: `No words came from ${source.name}. To bring them in, click the bookmarklet on your ${source.name} ${source.wordsName} page again. If you don't have it any more, drag it to your bookmarks bar from step 1 below.`,
      })
    }
  }, [active, handoff, source])

  // The user's cards, once there are words to check against them. If they don't load, every word is listed, and the
  // API leaves out the ones the user has when they're added.
  useEffect(() => {
    if (!received) {
      return
    }
    let cancelled = false
    listFlashCards()
      .then((cards) => {
        if (!cancelled) {
          const lower = (words: string[]) =>
            words.map((word) => word.toLowerCase())
          setKnown({
            spanish: new Set(cards.flatMap((card) => lower(card.spanish))),
            english: new Set(cards.flatMap((card) => lower(card.english))),
          })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trackException(error, { operation: 'loadCards' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [received])

  // Puts the cards in the user's deck for the site, making it the first time. The cards are added whatever happens to
  // the deck, so a failure is only said.
  async function putInDeck(ids: number[]) {
    if (ids.length === 0) {
      return
    }
    try {
      const deck = await addToNamedDeck(deckName, ids)
      deckId.current = deck.id
    } catch (error) {
      trackException(error, { operation: `${source.id}Deck` })
      setDeckError(
        `The cards were added, but couldn't be put in your ${deckName} deck.`,
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

  function describeAdded({ count, skippedCount }: Added) {
    const added = `Added ${cardCount(count)} to your ${deckName} deck.`
    if (skippedCount === 0) {
      return added
    }
    return `${added} ${skippedCount === 1 ? '1 card was' : `${skippedCount} cards were`} left out because you already have ${skippedCount === 1 ? 'it' : 'them'}.`
  }

  // Once every word's been added or removed, they're forgotten, so a reload doesn't bring them back.
  function finish(result: Added) {
    showToast({
      // The toast for the cards just added, one at a time or all at once, so each replaces the last.
      key: `${source.id}-added`,
      severity: 'success',
      message: describeAdded(result),
      action:
        deckId.current === null
          ? undefined
          : { label: 'Open deck', to: `/decks/${deckId.current}` },
    })
    setAddedCount(0)
    setCandidates([])
    clearHandoff()
  }

  function handleAddedOne(candidate: Candidate) {
    trackEvent(`${source.name}CardAdded`)
    const remaining = shown.filter((item) => item.key !== candidate.key)
    if (remaining.length === 0) {
      finish({ count: addedCount + 1, skippedCount: 0 })
    } else {
      showToast({
        key: `${source.id}-added`,
        severity: 'success',
        message: `Added “${formatWords(candidate.spanish)}” to your ${deckName} deck.`,
      })
      setAddedCount(addedCount + 1)
      setCandidates((current) =>
        current.filter((item) => item.key !== candidate.key),
      )
    }
  }

  function handleAddedAll(result: FlashCardBatch) {
    trackEvent(`${source.name}CardsAdded`, {
      count: String(result.cards.length),
    })
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
            Your words couldn&apos;t be read from {source.name}. {failure}
          </Alert>
        )}

        {handoff.status === 'waiting' && (
          <Box>
            <Box
              role="status"
              sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}
            >
              <CircularProgress aria-hidden size={32} />
              <Typography>Getting your words from {source.name}…</Typography>
            </Box>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              This only takes a few seconds. If nothing comes, click the
              bookmarklet on your {source.name} {source.wordsName} page again.
            </Typography>
            {/* The way back to the steps, and the bookmarklet, without waiting it out. */}
            <Button type="button" onClick={clearHandoff} sx={{ mt: 1, ml: -1 }}>
              Stop waiting
            </Button>
          </Box>
        )}

        {received && (
          <>
            <Typography color="text.secondary">
              These are the words in your {source.name} {source.wordsName}. You
              can change or remove them before you add them to your {deckName}{' '}
              deck, one at a time or all at once. Words you already have cards
              for are left out.
            </Typography>
            <Typography variant="h6" component="h2">
              {`${cardCount(shown.length)} from ${source.name}`}
            </Typography>
            {shown.length === 0 ? (
              <Typography color="text.secondary">
                {addedCount > 0
                  ? `You added ${cardCount(addedCount)} and removed the rest.`
                  : anyNew
                    ? 'You removed all the cards.'
                    : `There aren't any new words in your ${source.name} ${source.wordsName}.`}
              </Typography>
            ) : (
              <CardCandidates
                label={`Cards from ${source.name}`}
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
          handoff.status === 'timedOut') && (
          <BookmarkletSteps source={source} />
        )}
      </Stack>
    </Box>
  )
}
