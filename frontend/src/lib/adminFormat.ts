import type { AdminUserSummary } from '../api/admin'

// How the admin pages show users, dates and card sources.

// What to call a user: their name, or their sign-in when they have none.
export function userName(user: AdminUserSummary) {
  return user.displayName ?? user.subject
}

// The user's total score out of the most their cards could score, and as a percentage, as on their scores page. A
// user with no cards has nothing to score.
export function formatScore(user: AdminUserSummary) {
  return user.maximumScore === 0
    ? 'No cards'
    : `${user.score} / ${user.maximumScore} (${Math.round((user.score / user.maximumScore) * 100)}%)`
}

// A day, in the viewer's own locale, or the fallback when there's none (such as for what was made before it was
// recorded).
export function formatDate(date: string | null, fallback = 'Unknown') {
  return date === null
    ? fallback
    : new Date(date).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

// A moment, in the viewer's own locale and time zone, or the fallback when there's none.
export function formatDateTime(date: string | null, fallback = 'Unknown') {
  return date === null
    ? fallback
    : new Date(date).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
}

// A practice day ("YYYY-MM-DD"), which has no time zone, so it's shown as it is rather than moved into the viewer's.
export function formatDay(day: string) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

const sourceLabels: Record<string, string> = {
  Manual: 'Added by hand',
  Suggested: 'Suggestion',
  Document: 'Document scan',
  Preply: 'Preply',
  Duolingo: 'Duolingo',
  SystemDeck: 'Built-in deck',
  Mcp: 'AI assistant',
  Shared: 'Shared deck file',
  Unknown: 'Unknown',
}

// What to call how a card was made, from the API's source name.
export function sourceLabel(source: string) {
  return sourceLabels[source] ?? source
}
