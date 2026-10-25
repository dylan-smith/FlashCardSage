import { apiBaseUrl } from '../config'
import { getJson, jsonRequest } from './client'

// What the user has chosen on the preferences page. showPictures: whether cards' pictures are shown, in practice and
// where cards are managed. showSuggestions: whether the cards page suggests new cards, tags for a card being added or
// edited, and the Tags page new tags. autoTranslate: whether the
// side of a card the user types is translated into the other side, or they type both. showGettingStarted: whether
// the cards page shows the getting started guide (see GettingStarted), which Hide guide on it turns off.
export type Preferences = {
  showPictures: boolean
  showSuggestions: boolean
  autoTranslate: boolean
  showGettingStarted: boolean
}

// What a new user starts with, and what the app falls back to when the preferences can't be loaded.
export const defaultPreferences: Preferences = {
  showPictures: true,
  showSuggestions: true,
  autoTranslate: true,
  showGettingStarted: true,
}

const preferencesUrl = `${apiBaseUrl}/api/preferences`

export function getPreferences(signal?: AbortSignal) {
  return getJson<Preferences>(preferencesUrl, 'Unable to load preferences.', {
    signal,
  })
}

export function savePreferences(preferences: Preferences) {
  return getJson<Preferences>(
    preferencesUrl,
    'Unable to save preferences.',
    jsonRequest('PUT', preferences),
  )
}
