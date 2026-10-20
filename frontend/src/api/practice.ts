import type { Deck } from './decks'
import { flashCardsUrl } from './flashCards'
import type { FlashCardWords, PracticeOutcome, Tag } from './flashCards'
import { getJson, jsonRequest } from './client'

// A card as practice needs it on the device: its words, its score out of 100, when it was last practiced (null if
// never), its picture (null for a card without one) and the ids of its tags.
export type PackCard = FlashCardWords & {
  score: number
  lastPracticedAt: string | null
  imageUrl: string | null
  tagIds: number[]
}

// Everything practice needs to run without the API: the user's cards with their scores, and their decks and tags to
// pick which cards to practice. The device keeps the last one loaded (see practice/pack).
export type PracticePack = {
  cards: PackCard[]
  decks: Deck[]
  tags: Tag[]
}

// An answer given in practice, kept on the device until the API has it. id is made on the device, so sending it again
// (after a lost response, or from another tab) doesn't record it twice.
export type PracticeResultToSync = {
  id: string
  flashCardId: number
  outcome: PracticeOutcome
  practicedAt: string
}

// How many of the answers sent the API recorded. One it already had, or for a card that's gone, isn't counted.
export type SyncResponse = {
  accepted: number
}

export function getPracticePack(signal?: AbortSignal) {
  return getJson<PracticePack>(
    `${flashCardsUrl}/practice/pack`,
    'Unable to load flash cards.',
    { signal },
  )
}

// Saves the answers, oldest first.
export function sendPracticeResults(results: PracticeResultToSync[]) {
  return getJson<SyncResponse>(
    `${flashCardsUrl}/practice-results`,
    'Unable to save your answers.',
    jsonRequest('POST', { results }),
  )
}
