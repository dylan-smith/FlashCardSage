import { defaultPreferences, getPreferences } from '../api/preferences'
import type { Preferences } from '../api/preferences'
import { readJson, writeJson } from '../lib/localJson'
import { storageKeys, userStorageKey } from '../lib/storageKeys'
import { createStore } from '../lib/store'
import { trackException } from '../telemetry'

// The signed-in user's preferences, which the app loads when they sign in (see App), or null until they've loaded.
// Each preference counts as off until then, so a picture or the suggestions (which cost a request to the model)
// aren't shown to a user who turned them off.
const store = createStore<Preferences | null>(null)

export const setPreferences = store.set

export const currentPreferences = store.get

export function usePreferences() {
  return store.use()
}

function isPreferences(value: unknown): value is Preferences {
  const preferences = value as Partial<Preferences> | null
  return (
    typeof preferences === 'object' &&
    preferences !== null &&
    typeof preferences.showPictures === 'boolean' &&
    typeof preferences.showSuggestions === 'boolean' &&
    typeof preferences.autoTranslate === 'boolean'
  )
}

// Loads the preferences of the signed-in user, whose subject (see sessionSubject) they're kept on the device under, so
// they still apply offline. When they can't be loaded, the ones last kept are used, and otherwise the app works as it
// does for a new user.
export function loadPreferences(subject: string, signal: AbortSignal) {
  const key = userStorageKey(storageKeys.preferences, subject)
  getPreferences(signal)
    .then((preferences) => {
      if (!signal.aborted) {
        writeJson(key, preferences)
        setPreferences(preferences)
      }
    })
    .catch((error: unknown) => {
      if (!signal.aborted) {
        trackException(error, { operation: 'loadPreferences' })
        setPreferences(readJson(key, isPreferences) ?? defaultPreferences)
      }
    })
}
