import { apiBaseUrl } from '../config'
import { apiFetch } from './client'

// What the user has chosen on the preferences page. showPictures: whether cards' pictures are shown, in practice and
// where cards are managed. showSuggestions: whether the cards page suggests new cards, and tags for a card being added
// or edited. autoTranslate: whether the
// side of a card the user types is translated into the other side, or they type both.
export type Preferences = {
  showPictures: boolean
  showSuggestions: boolean
  autoTranslate: boolean
}

// What a new user starts with, and what the app falls back to when the preferences can't be loaded.
export const defaultPreferences: Preferences = {
  showPictures: true,
  showSuggestions: true,
  autoTranslate: true,
}

const preferencesUrl = `${apiBaseUrl}/api/preferences`

export async function getPreferences(
  signal?: AbortSignal,
): Promise<Preferences> {
  const response = await apiFetch(preferencesUrl, { signal })
  if (!response.ok) {
    throw new Error('Unable to load preferences.')
  }
  return (await response.json()) as Preferences
}

export async function savePreferences(
  preferences: Preferences,
): Promise<Preferences> {
  const response = await apiFetch(preferencesUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(preferences),
  })
  if (!response.ok) {
    throw new Error('Unable to save preferences.')
  }
  return (await response.json()) as Preferences
}
