import type { PackCard } from '../api/practice'
import type { PracticeOutcome } from '../api/flashCards'

// How well the user knows a card, out of 100, from how many times in a row they've got it right in practice. The
// same as the API's PracticeScore, which scores the answers once they're saved.

export const maximumScore = 100

// The score for 0, 1, 2, 3, 4 and 5 or more correct answers in a row.
export const scoresByStreak = [0, 50, 80, 90, 95, maximumScore]

// The longest run that still raises the score.
const maximumStreak = scoresByStreak.length - 1

export function fromStreak(correctInARow: number) {
  if (correctInARow < 0) {
    throw new RangeError('A run of correct answers cannot be negative.')
  }
  return scoresByStreak[Math.min(correctInARow, maximumStreak)]
}

// How many times in a row the card was got right to have the score. A score that isn't in the table, which the API
// never sends, counts as none.
export function streakFromScore(score: number) {
  return Math.max(0, scoresByStreak.indexOf(score))
}

// The score after an answer: Got it! adds one to the run, and anything else ends it.
export function scoreAfter(score: number, outcome: PracticeOutcome) {
  return outcome === 'GotIt'
    ? fromStreak(Math.min(streakFromScore(score) + 1, maximumStreak))
    : 0
}

// The card as it is once the answer, given at practicedAt, is saved.
export function applyAnswer(
  card: PackCard,
  outcome: PracticeOutcome,
  practicedAt: string,
): PackCard {
  return {
    ...card,
    score: scoreAfter(card.score, outcome),
    lastPracticedAt: practicedAt,
  }
}
