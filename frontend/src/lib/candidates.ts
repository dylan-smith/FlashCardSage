import { cardImageDataUrl } from '../api/cardImages'
import type { CardImage } from '../api/cardImages'
import type { FlashCard, FlashCardFields } from '../api/flashCards'

// A card to add, such as one made from a document, a Preply word or a suggestion, with a key of its own, since the
// user can change it like any card: its words, its tags and a picture. The picture is kept here until the card is
// added, and then put on it.
export type Candidate = FlashCardFields & {
  key: number
  picture: CardImage | null
}

// What's being added: all the cards, or the one with this key.
export type Adding = 'all' | number | null

// A candidate as a card, so it's shown like the user's cards are, with its picture if it has one.
export function asCard(candidate: Candidate): FlashCard {
  return {
    id: candidate.key,
    spanish: candidate.spanish,
    english: candidate.english,
    tags: candidate.tags.map((name, id) => ({ id, name })),
    imageUrl:
      candidate.picture === null ? null : cardImageDataUrl(candidate.picture),
  }
}
