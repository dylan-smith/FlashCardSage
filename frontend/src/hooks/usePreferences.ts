import { useRef } from 'react'
import { describeFetchError } from '../api/client'
import {
  defaultPreferences,
  getPreferences,
  savePreferences,
} from '../api/preferences'
import type { Preferences } from '../api/preferences'
import { readJson, writeJson } from '../lib/localJson'
import { storageKeys, userStorageKey } from '../lib/storageKeys'
import { createStore } from '../lib/store'
import { trackEvent, trackException } from '../telemetry'

// The signed-in user's preferences, which the app loads when they sign in (see App), or null until they've loaded.
// Each preference counts as off until then, so a picture or the suggestions (which cost a request to the model)
// aren't shown to a user who turned them off.
const store = createStore<Preferences | null>(null)

export const setPreferences = store.set

export const currentPreferences = store.get

export function usePreferences() {
  return store.use()
}

// Changes one of the signed-in user's preferences: shows the change right away, saves it, and turns it back and
// tells onError why when it isn't saved. The saves go one after another, so the last change is the one the API keeps.
// event is what's reported once it's saved.
export function useChangePreference(onError: (message: string) => void) {
  const saves = useRef(Promise.resolve())
  return function change(
    key: keyof Preferences,
    value: boolean,
    event = 'PreferencesUpdated',
  ) {
    const preferences = store.get()
    if (preferences === null) {
      return
    }
    const changed = { ...preferences, [key]: value }
    setPreferences(changed)
    saves.current = saves.current.then(async () => {
      try {
        await savePreferences(changed)
        trackEvent(event)
      } catch (error) {
        trackException(error, { operation: 'savePreferences' })
        const latest = store.get()
        if (latest !== null) {
          setPreferences({ ...latest, [key]: !value })
        }
        onError(describeFetchError(error, 'Unable to save preferences.'))
      }
    })
  }
}

function isPreferences(value: unknown): value is Preferences {
  const preferences = value as Partial<Preferences> | null
  return (
    typeof preferences === 'object' &&
    preferences !== null &&
    typeof preferences.showPictures === 'boolean' &&
    typeof preferences.showSuggestions === 'boolean' &&
    typeof preferences.autoTranslate === 'boolean' &&
    typeof preferences.showGettingStarted === 'boolean'
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
