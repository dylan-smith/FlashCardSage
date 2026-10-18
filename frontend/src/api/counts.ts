import { apiBaseUrl } from '../config'
import { getJson } from './client'

// How many cards, decks and tags the user has.
export type Counts = {
  cards: number
  decks: number
  tags: number
}

export const countsUrl = `${apiBaseUrl}/api/counts`

export function getCounts() {
  return getJson<Counts>(countsUrl, 'Unable to load counts.')
}
