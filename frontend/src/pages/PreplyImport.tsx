import { useEffect, useState, useSyncExternalStore } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router'
import { changeDeckCards, createDeck, listDecks } from '../api/decks'
import {
  createFlashCard,
  createFlashCards,
  formatWords,
  listFlashCards,
} from '../api/flashCards'
import type { FlashCardBatch, FlashCardFields } from '../api/flashCards'
import { useUserTags } from '../hooks/useUserTags'
import {
  clearPreplyHandoff,
  getPreplyHandoff,
  subscribePreplyHandoff,
} from '../preply/preplyHandoff'
import type { PreplyHandoff } from '../preply/preplyHandoff'
import type { PreplyWord } from '../preply/sendToFlashCardSage'
import { trackEvent, trackException } from '../telemetry'
import { CardCandidates } from './CardCandidates'
import type { Adding, Candidate } from './CardCandidates'
import { cardCount } from './cardCount'
import { PreplyBookmarklet } from './PreplyBookmarklet'

// The deck the user's Preply words go in, made the first time and added to after.
export const preplyDeckName = 'Preply'

// As many cards as the API adds in one request (FlashCardBatchRequest.MaxCards), so a longer vocabulary is added a
// part at a time.
const batchSize = 100

// The words on the user's cards, by language and ignoring case, so the Preply words they already have are left out.
type Known = { spanish: Set<string>; english: Set<string> }

// What adding the cards did: how many went in, one at a time or all at once, and how many were left out.
type Added = { count: number; skippedCount: number }

function toCandidates(words: PreplyWord[]): Candidate[] {
  return words.flatMap((word, key) =>
    word.english === null
      ? []
      : [
          {
            spanish: [word.spanish],
            english: [word.english],
            tags: [],
            key,
            picture: null,
          },
        ],
  )
}

function isKnown(known: Known, candidate: Candidate) {
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
// bookmarklet sends words, it says how to use it.
export function PreplyImport() {
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
  const [known, setKnown] = useState<Known | null>(null)
  const [adding, setAdding] = useState<Adding>(null)
  // How many the user has added one at a time, the card just added that way, and what adding them all did.
  const [addedCount, setAddedCount] = useState(0)
  const [addedOne, setAddedOne] = useState('')
  const [added, setAdded] = useState<Added | null>(null)
  const [deckId, setDeckId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [deckError, setDeckError] = useState('')
  const [tags, addNewTags] = useUserTags()

  const received = handoff.status === 'received'
  const words = received ? handoff.words : []
  const noEnglish = words.filter((word) => word.english === null).length
  const shown =
    known === null
      ? candidates
      : candidates.filter((candidate) => !isKnown(known, candidate))
  const alreadyHave = candidates.length - shown.length
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

  // Puts the cards in the user's Preply deck, making it the first time. The cards are added whatever happens to the
  // deck, so a failure is only said.
  async function putInDeck(ids: number[]) {
    if (ids.length === 0) {
      return
    }
    try {
      const existing = (await listDecks()).find(
        (deck) =>
          deck.name.localeCompare(preplyDeckName, undefined, {
            sensitivity: 'accent',
          }) === 0,
      )
      const deck = existing
        ? await changeDeckCards(existing.id, { add: ids })
        : await createDeck({ name: preplyDeckName, flashCardIds: ids })
      setDeckId(deck.id)
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
      setAddedOne('')
      setDeckError('')
    }
  }

  // Once every word's been added or removed, they're forgotten, so a reload doesn't bring them back.
  function finish(result: Added) {
    setAdded(result)
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
      setAddedOne(
        `Added “${formatWords(candidate.spanish)}” to your ${preplyDeckName} deck.`,
      )
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
        {added && (
          <Alert
            severity="success"
            action={
              deckId !== null && (
                <Button
                  component={RouterLink}
                  to={`/decks/${deckId}`}
                  color="inherit"
                  size="small"
                >
                  Open deck
                </Button>
              )
            }
          >
            {describeAdded(added)}
          </Alert>
        )}
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
        {handoff.status === 'timedOut' && (
          <Alert severity="info">
            No words came from Preply. To bring them in, click the bookmarklet
            on your Preply vocabulary page again. If you don&apos;t have it any
            more, drag it to your bookmarks bar from step 1 below.
          </Alert>
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
            {alreadyHave > 0 && (
              <Alert severity="info">
                {`${alreadyHave === 1 ? '1 word is' : `${alreadyHave} words are`} left out because you already have ${alreadyHave === 1 ? 'a card' : 'cards'} for ${alreadyHave === 1 ? 'it' : 'them'}.`}
              </Alert>
            )}
            {noEnglish > 0 && (
              <Alert severity="info">
                {`${noEnglish === 1 ? '1 word is' : `${noEnglish} words are`} left out because Preply has no English for ${noEnglish === 1 ? 'it' : 'them'}.`}
              </Alert>
            )}
            {addedOne && <Alert severity="success">{addedOne}</Alert>}
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
