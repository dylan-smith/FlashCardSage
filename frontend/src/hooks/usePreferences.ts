import { defaultPreferences, getPreferences } from '../api/preferences'
import type { Preferences } from '../api/preferences'
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

// Loads the signed-in user's preferences. When they can't be loaded, the app works as it does for a new user.
export function loadPreferences(signal: AbortSignal) {
  getPreferences(signal)
    .then((preferences) => {
      if (!signal.aborted) {
        setPreferences(preferences)
      }
    })
    .catch((error: unknown) => {
      if (!signal.aborted) {
        trackException(error, { operation: 'loadPreferences' })
        setPreferences(defaultPreferences)
      }
    })
}
