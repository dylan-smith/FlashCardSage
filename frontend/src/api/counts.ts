import { apiBaseUrl } from '../config'
import { apiFetch } from './client'

// How many cards, decks and tags the user has.
export type Counts = {
  cards: number
  decks: number
  tags: number
}

export const countsUrl = `${apiBaseUrl}/api/counts`

export async function getCounts(): Promise<Counts> {
  const response = await apiFetch(countsUrl)
  if (!response.ok) {
    throw new Error('Unable to load counts.')
  }
  return (await response.json()) as Counts
}
