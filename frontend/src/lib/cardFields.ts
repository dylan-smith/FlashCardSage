import { formatWords } from '../api/flashCards'
import type { FlashCardFields } from '../api/flashCards'
import { trimWords } from './text'
import type { CardSide, CardText } from '../api/translations'

export const spanishRequiredMessage = 'Spanish is required.'
export const englishRequiredMessage = 'English is required.'

// A change to a form's fields, made from the fields as they are when it's applied, so a translation that arrives
// late doesn't undo what the user typed in the meantime.
export type FieldsUpdate = (fields: FlashCardFields) => FlashCardFields

// Trims the words on both sides of a card, leaving out blank ones, or returns the message for the first side left
// with none. The API tidies up the tags.
export function trimFields(fields: FlashCardFields): FlashCardFields | string {
  const spanish = trimWords(fields.spanish)
  const english = trimWords(fields.english)
  if (spanish.length === 0) {
    return spanishRequiredMessage
  }
  if (english.length === 0) {
    return englishRequiredMessage
  }
  return { spanish, english, tags: fields.tags }
}

// The first word on each side, which is the one auto-translation works on.
export function firstWords(fields: FlashCardFields): CardText {
  return { spanish: fields.spanish[0] ?? '', english: fields.english[0] ?? '' }
}

// Puts a change to the first words into the fields.
export function setFirstWords(change: Partial<CardText>): FieldsUpdate {
  return (fields) => ({
    ...fields,
    spanish:
      change.spanish === undefined
        ? fields.spanish
        : [change.spanish, ...fields.spanish.slice(1)],
    english:
      change.english === undefined
        ? fields.english
        : [change.english, ...fields.english.slice(1)],
  })
}

// A change to one side's words.
export type WordsUpdate = (words: string[]) => string[]

export function updateWords(side: CardSide, update: WordsUpdate): FieldsUpdate {
  return (fields) =>
    side === 'spanish'
      ? { ...fields, spanish: update(fields.spanish) }
      : { ...fields, english: update(fields.english) }
}

// Each side's words as one line, for a picture of the card.
export function pictureWords(fields: FlashCardFields): CardText {
  return {
    spanish: formatWords(trimWords(fields.spanish)),
    english: formatWords(trimWords(fields.english)),
  }
}
