import { apiBaseUrl } from '../config'
import { apiFetch } from './client'
import type { FlashCardWords } from './flashCards'

// A side of a card, by its field name.
export type CardSide = Exclude<keyof FlashCardWords, 'id'>

// One piece of text for each side of a card, such as the word being typed in on each.
export type CardText = Record<CardSide, string>

const languages: Record<CardSide, string> = {
  spanish: 'Spanish',
  english: 'English',
}

// The translation of one side, and for a single word its other meanings, most common first.
export type Translation = {
  translation: string
  alternatives: string[]
}

// Translates one side of a card into the other. Throws when translation fails or isn't available (a 503, e.g.
// locally, where there's no translator key).
export async function translate(
  text: string,
  from: CardSide,
  signal?: AbortSignal,
): Promise<Translation> {
  const response = await apiFetch(`${apiBaseUrl}/api/translations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, from: languages[from] }),
    signal,
  })
  if (!response.ok) {
    throw new Error('Unable to translate.')
  }
  const { translation, alternatives } = (await response.json()) as {
    translation?: unknown
    alternatives?: unknown
  }
  if (typeof translation !== 'string') {
    throw new Error('Unable to translate.')
  }
  return {
    translation,
    alternatives: Array.isArray(alternatives)
      ? alternatives.filter((item): item is string => typeof item === 'string')
      : [],
  }
}
