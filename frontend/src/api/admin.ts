import { apiBaseUrl } from '../config'
import { ApiError, ResponseError, apiFetch } from './client'
import type { PracticeOutcome } from './flashCards'
import type { Connection } from './oauth'
import type { Preferences } from './preferences'

// Read-only views of every user's data, for the admins the API lets in (see the API's Admin:Users). Dates are ISO 8601
// strings, and a day (such as a practice day) is "YYYY-MM-DD".

// How many cards came from each way of adding them, keyed by the API's source names (Manual, Suggested, Document,
// Preply, Duolingo, SystemDeck, Mcp, Import), with Unknown for cards made before sources were recorded.
export type CardsBySource = Record<string, number>

// Everyone's totals. Only people count: the built-in decks' system user is left out.
export type AdminOverview = {
  users: number
  activeUsersLast7Days: number
  activeUsersLast30Days: number
  newUsersLast30Days: number
  cards: number
  decks: number
  tags: number
  practiceResults: number
  practiceResultsLast7Days: number
  practiceResultsLast30Days: number
  cardsBySource: CardsBySource
  cachedTranslations: number
  generatedImages: number
  generatedAudio: number
  oAuthClients: number
  connectedApps: number
}

// A user and how much they have. provider is the part of their subject before the colon, such as "google".
export type AdminUserSummary = {
  id: number
  subject: string
  provider: string
  displayName: string | null
  email: string | null
  createdAt: string
  lastSeenAt: string | null
  cards: number
  decks: number
  tags: number
  practiceResults: number
  lastPracticedAt: string | null
  connectedApps: number
  // The total of their cards' practice scores, out of the most their cards could score.
  score: number
  maximumScore: number
}

export type AdminPracticeResult = {
  flashCardId: number
  spanish: string[]
  outcome: PracticeOutcome
  practicedAt: string
}

// How the user has practiced: each outcome's total, how many answers each of the last 30 days had (oldest first,
// ending today), and their latest answers, newest first.
export type AdminPracticeSummary = {
  gotIt: number
  wasClose: number
  failed: number
  firstPracticedAt: string | null
  lastPracticedAt: string | null
  byDay: { date: string; results: number }[]
  recent: AdminPracticeResult[]
}

export type AdminUserDetail = {
  user: AdminUserSummary
  preferences: Preferences
  decks: {
    id: number
    name: string
    createdAt: string | null
    cardCount: number
  }[]
  tags: { id: number; name: string; cardCount: number }[]
  practice: AdminPracticeSummary
  connectedApps: Connection[]
  cardsBySource: CardsBySource
}

// One of a user's cards. source is a source name as in CardsBySource.
export type AdminCard = {
  id: number
  spanish: string[]
  english: string[]
  tags: string[]
  decks: string[]
  imageUrl: string | null
  createdAt: string | null
  source: string
  score: number
  gotIt: number
  wasClose: number
  failed: number
  lastPracticedAt: string | null
}

const adminUrl = `${apiBaseUrl}/api/admin`

export const notAdminMessage = 'Only admins can see this page.'

// The response's JSON, or null for a user that doesn't exist (a 404). A 403 means the signed-in user isn't an admin,
// which is shown as it is.
async function getAdminJson<T>(
  url: string,
  fallback: string,
  signal?: AbortSignal,
): Promise<T | null> {
  const response = await apiFetch(url, { signal })
  if (response.status === 403) {
    throw new ApiError(403, notAdminMessage)
  }
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new ResponseError(response.status, fallback)
  }
  return (await response.json()) as T
}

// Never null: the overview and the users are always there.
async function getAdminList<T>(
  url: string,
  fallback: string,
  signal?: AbortSignal,
): Promise<T> {
  const data = await getAdminJson<T>(url, fallback, signal)
  if (data === null) {
    throw new ResponseError(404, fallback)
  }
  return data
}

export function getAdminOverview(signal?: AbortSignal) {
  return getAdminList<AdminOverview>(
    `${adminUrl}/overview`,
    'Unable to load the overview.',
    signal,
  )
}

// Every user, the one seen most recently first.
export function listAdminUsers(signal?: AbortSignal) {
  return getAdminList<AdminUserSummary[]>(
    `${adminUrl}/users`,
    'Unable to load the users.',
    signal,
  )
}

// The user, or null when there's no user with the id.
export function getAdminUser(id: number, signal?: AbortSignal) {
  return getAdminJson<AdminUserDetail>(
    `${adminUrl}/users/${id}`,
    'Unable to load the user.',
    signal,
  )
}

// The user's cards, or null when there's no user with the id.
export function listAdminUserCards(id: number, signal?: AbortSignal) {
  return getAdminJson<AdminCard[]>(
    `${adminUrl}/users/${id}/cards`,
    "Unable to load the user's cards.",
    signal,
  )
}
