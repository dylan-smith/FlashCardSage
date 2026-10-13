import { useSyncExternalStore } from 'react'
import { defaultPreferences, getPreferences } from '../api/preferences'
import type { Preferences } from '../api/preferences'
import { trackException } from '../telemetry'

// The signed-in user's preferences, which the app loads when they sign in (see App), or null until they've loaded.
// Each preference counts as off until then, so a picture or the suggestions (which cost a request to the model)
// aren't shown to a user who turned them off.

type Listener = () => void

const listeners = new Set<Listener>()

let current: Preferences | null = null

export function setPreferences(preferences: Preferences | null) {
  if (preferences === current) {
    return
  }
  current = preferences
  listeners.forEach((listener) => listener())
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function currentPreferences() {
  return current
}

export function usePreferences() {
  return useSyncExternalStore(subscribe, currentPreferences)
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
