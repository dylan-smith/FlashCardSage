import type { PracticeCard } from '../api/flashCards'
import type { PackCard } from '../api/practice'
import { maximumScore } from './score'

// What the picker needs to know about a card.
export type ScoredCard = Pick<
  PackCard,
  'id' | 'spanish' | 'english' | 'score' | 'lastPracticedAt' | 'imageUrl'
>

const day = 24 * 60 * 60 * 1000

// How likely a card is to come up, up to the maximum score for a card never practiced. The lower its score, the
// likelier it is, and it gains one for every day since it was last practiced, so even a card with the maximum score
// comes back now and then.
export function weight(card: ScoredCard, now: Date) {
  const days =
    card.lastPracticedAt === null
      ? 0
      : Math.max(
          0,
          (now.getTime() - new Date(card.lastPracticedAt).getTime()) / day,
        )
  return Math.min(maximumScore, maximumScore - card.score + days)
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

// Picks a card by its weight, and the side shown first, from two rolls between 0 and 1 (such as Math.random()). The
// card just practiced isn't picked again straight away, unless it's the only one. When every card has no weight,
// they're all as likely as each other. Null when there are no cards.
export function pick(
  cards: ScoredCard[],
  previousId: number | null,
  now: Date,
  cardRoll: number,
  sideRoll: number,
): PracticeCard | null {
  const choices =
    cards.length > 1 ? cards.filter((card) => card.id !== previousId) : cards
  if (choices.length === 0) {
    return null
  }

  const weights = choices.map((card) => weight(card, now))
  const chances = sum(weights) > 0 ? weights : choices.map(() => 1)
  let target = cardRoll * sum(chances)
  // Falls back to the last card that can be picked, in case rounding leaves the target past the end.
  let index = chances.findLastIndex((chance) => chance > 0)
  for (let position = 0; position < chances.length; position++) {
    target -= chances[position]
    if (target < 0) {
      index = position
      break
    }
  }

  const card = choices[index]
  return {
    id: card.id,
    spanish: card.spanish,
    english: card.english,
    side: sideRoll < 0.5 ? 'Spanish' : 'English',
    imageUrl: card.imageUrl,
  }
}
