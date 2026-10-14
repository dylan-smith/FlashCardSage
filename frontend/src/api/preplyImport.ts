import { apiBaseUrl } from '../config'
import { refreshCounts } from '../hooks/useCounts'
import { apiFetch } from './client'
import type { DeckImport } from './decks'
import { throwIfNotSaved } from './flashCards'

// A word from the user's Preply vocabulary to make a card of.
export type PreplyImportWord = {
  spanish: string
  english: string
}

export const preplyImportUrl = `${apiBaseUrl}/api/preply-import`

// Makes a new Preply deck with a card for each word, leaving out words the user already has.
export async function importPreplyWords(
  words: PreplyImportWord[],
): Promise<DeckImport> {
  const response = await apiFetch(preplyImportUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words }),
  })
  await throwIfNotSaved(response, 'Unable to add the words.')
  refreshCounts()
  return (await response.json()) as DeckImport
}
