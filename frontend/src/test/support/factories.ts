import { apiBaseUrl } from '../../config'
import type { Deck } from '../../api/decks'
import type { FlashCard, Tag } from '../../api/flashCards'

// The full URL of an API path, such as api('/flashcards/1').
export function api(path: string) {
  return `${apiBaseUrl}/api${path}`
}

// A card as the API sends it, with one or more words on each side, and no tags or picture unless fields gives them.
export function card(
  id: number,
  spanish: string | string[],
  english: string | string[],
  fields: Partial<FlashCard> = {},
): FlashCard {
  return {
    id,
    spanish: typeof spanish === 'string' ? [spanish] : spanish,
    english: typeof english === 'string' ? [english] : english,
    tags: [],
    imageUrl: null,
    ...fields,
  }
}

export function tag(id: number, name: string): Tag {
  return { id, name }
}

export function deck(
  id: number,
  name: string,
  flashCardIds: number[] = [],
): Deck {
  return { id, name, flashCardIds }
}

// The cards and tag most tests use.
export const cat = card(1, 'el gato', 'the cat')
export const dog = card(2, 'el perro', 'the dog')
export const pets = tag(4, 'Pets')
