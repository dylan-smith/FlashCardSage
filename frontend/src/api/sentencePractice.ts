import { flashCardsUrl } from './flashCards'
import type {
  PracticeOutcome,
  PracticeSelection,
  PracticeSide,
} from './flashCards'
import { fetchOk, getJson, jsonRequest, optional, withQuery } from './client'

// A sentence written from the user's cards to practice, in Spanish and English, and the ids of the cards it uses.
export type PracticeSentence = {
  spanish: string
  english: string
  cardIds: number[]
}

// How the user did at a sentence, and the side they were shown first.
export type SentenceResult = PracticeSentence & {
  shownSide: PracticeSide
  outcome: PracticeOutcome
}

// The fewest cards sentences can be made from, the same as the API's limit.
export const minSentenceCards = 3

// A handful of new sentences from the selection's cards, none when nothing usable came back, or null when sentences
// aren't available (a 503, e.g. locally, where there's no Foundry endpoint and key).
export function getPracticeSentences(
  { deckId, tagId }: PracticeSelection,
  signal?: AbortSignal,
) {
  return optional(
    getJson<PracticeSentence[]>(
      withQuery(`${flashCardsUrl}/practice/sentences`, { deckId, tagId }),
      'Unable to make sentences.',
      { signal },
    ),
  )
}

// Saves how the user did at a sentence. It's kept to learn from, and doesn't change the cards' scores.
export async function sendSentenceResult(result: SentenceResult) {
  await fetchOk(
    `${flashCardsUrl}/practice/sentences/results`,
    'Unable to save your answer.',
    jsonRequest('POST', result),
  )
}
