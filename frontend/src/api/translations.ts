import { apiBaseUrl } from '../config'
import { apiFetch } from './client'
import type { FlashCardFields } from './flashCards'

// A side of a card, by its field name.
export type CardSide = keyof FlashCardFields

const languages: Record<CardSide, string> = {
  spanish: 'Spanish',
  english: 'English',
}

// Translates one side of a card into the other. Throws when translation fails or isn't available (a 503, e.g.
// locally, where there's no translator key).
export async function translate(
  text: string,
  from: CardSide,
  signal?: AbortSignal,
): Promise<string> {
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
  const { translation } = (await response.json()) as { translation?: unknown }
  if (typeof translation !== 'string') {
    throw new Error('Unable to translate.')
  }
  return translation
}
