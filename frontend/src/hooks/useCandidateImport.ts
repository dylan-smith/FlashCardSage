import { useRef, useState } from 'react'
import { addToNamedDeck } from '../api/decks'
import {
  createFlashCard,
  createFlashCards,
  formatWords,
} from '../api/flashCards'
import type { FlashCardBatch, FlashCardFields } from '../api/flashCards'
import { cardCount, skippedSentence } from '../lib/cardCount'
import type { Adding, Candidate } from '../lib/candidates'
import { trackEvent, trackException } from '../telemetry'
import { showToast } from '../toasts'
import type { Toast } from '../toasts'
import { useUserTags } from './useUserTags'

// As many cards as the API adds in one request (FlashCardBatchRequest.MaxCards), so a longer list is added a part at
// a time.
const batchSize = 100

export type CandidateImportOptions = {
  // The deck the cards go in, made the first time and added to after.
  deckName: string
  // Where the cards are from, such as the document's name, said when they're added.
  source?: string
  // The toast for the cards just added, one at a time or all at once, so each replaces the last.
  toastKey: string
  // Tracked when a card is added on its own and when they're added all at once, with how many with countAll.
  events: { addedOne: string; addedAll: string; countAll?: boolean }
  // Reported when the cards couldn't be put in the deck.
  deckOperation: string
  // Said once every card's been added or removed, such as that there may be more.
  finishedNote?: string
  // The toast's link when the cards couldn't be put in the deck.
  noDeckAction?: Toast['action']
  // Cards left out of the list, such as ones the user already has.
  hidden?: (candidate: Candidate) => boolean
  initialCandidates?: () => Candidate[]
  // Called once every card's been added or removed.
  onFinish: () => void
}

// Cards for the user to look over in a CardCandidates list and add one at a time or all at once to the deck named
// deckName, such as the ones scanned from a document or brought in from Preply. It keeps the list, what's being added,
// how many have been added, the deck they went in and whether they couldn't be put in it, and says what was added in a
// toast. Once none are left, the last toast links to the deck and onFinish is called. listProps are the list's props
// but its label, search and onError.
export function useCandidateImport({
  deckName,
  source,
  toastKey,
  events,
  deckOperation,
  finishedNote,
  noDeckAction,
  hidden,
  initialCandidates,
  onFinish,
}: CandidateImportOptions) {
  const [candidates, setCandidates] = useState<Candidate[]>(
    initialCandidates ?? [],
  )
  const [adding, setAdding] = useState<Adding>(null)
  // How many the user has added so far, and how many of those were left out because the user already had them.
  const [addedCount, setAddedCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)
  // The deck the cards went in, for the toast's link once they're all added.
  const deckId = useRef<number | null>(null)
  const [deckError, setDeckError] = useState('')
  const [tags, addNewTags] = useUserTags()

  const shown =
    hidden === undefined
      ? candidates
      : candidates.filter((candidate) => !hidden(candidate))

  // Starts over with no cards, such as before a new scan.
  function reset() {
    setCandidates([])
    setAddedCount(0)
    setSkippedCount(0)
    deckId.current = null
    setDeckError('')
  }

  // What adding the cards did, naming where they're from and the deck they went in.
  function describeAdded(count: number, skipped: number, note?: string) {
    let text = `Added ${cardCount(count)}${source === undefined ? '' : ` from “${source}”`} to your ${deckName} deck.`
    if (skipped > 0) {
      text += ` ${skippedSentence(skipped)}`
    }
    if (note !== undefined) {
      text += ` ${note}`
    }
    return text
  }

  // Puts the cards in the deck, making it the first time. The cards are added whatever happens to the deck, so a
  // failure is only said.
  async function putInDeck(ids: number[]) {
    if (ids.length === 0) {
      return
    }
    try {
      const deck = await addToNamedDeck(deckName, ids)
      deckId.current = deck.id
    } catch (error) {
      trackException(error, { operation: deckOperation })
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

  // Once every card's been added or removed, says what was added, with a link to their deck.
  function finish(count: number, skipped: number) {
    showToast({
      key: toastKey,
      severity: 'success',
      message: describeAdded(count, skipped, finishedNote),
      action:
        deckId.current === null
          ? noDeckAction
          : { label: 'Open deck', to: `/decks/${deckId.current}` },
    })
    setAddedCount(0)
    setSkippedCount(0)
    setCandidates([])
    onFinish()
  }

  function handleAddedOne(candidate: Candidate) {
    trackEvent(events.addedOne)
    const remaining = shown.filter((item) => item.key !== candidate.key)
    if (remaining.length === 0) {
      // The last one, as if they'd all been added at once.
      finish(addedCount + 1, skippedCount)
    } else {
      showToast({
        key: toastKey,
        severity: 'success',
        message: `Added “${formatWords(candidate.spanish)}” to your ${deckName} deck.`,
      })
      setAddedCount(addedCount + 1)
      setCandidates((current) =>
        current.filter((item) => item.key !== candidate.key),
      )
    }
  }

  // All the cards, or just the ones that match a search, so it's only finished once none are left.
  function handleAddedAll(result: FlashCardBatch, added: Candidate[]) {
    if (events.countAll) {
      trackEvent(events.addedAll, { count: String(result.cards.length) })
    } else {
      trackEvent(events.addedAll)
    }
    // With the ones the user added before.
    const totalAdded = result.cards.length + addedCount
    const totalSkipped = result.skippedCount + skippedCount
    const remaining = shown.filter(
      (candidate) => !added.some((item) => item.key === candidate.key),
    )
    if (remaining.length === 0) {
      finish(totalAdded, totalSkipped)
    } else {
      showToast({
        key: toastKey,
        severity: 'success',
        message: describeAdded(result.cards.length, result.skippedCount),
      })
      setAddedCount(totalAdded)
      setSkippedCount(totalSkipped)
      setCandidates((current) =>
        current.filter(
          (candidate) => !added.some((item) => item.key === candidate.key),
        ),
      )
    }
  }

  return {
    candidates,
    setCandidates,
    shown,
    adding,
    addedCount,
    deckError,
    reset,
    listProps: {
      candidates: shown,
      onCandidatesChange: setCandidates,
      tags,
      onTagsAdded: addNewTags,
      adding,
      onAddingChange: handleAdding,
      addOne,
      addAll,
      onAddedOne: handleAddedOne,
      onAddedAll: handleAddedAll,
    },
  }
}
