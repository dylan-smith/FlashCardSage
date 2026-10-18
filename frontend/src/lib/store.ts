import { useSyncExternalStore } from 'react'

// A value the app keeps outside React, such as the signed-in user, that components re-render with when it changes.
export type Store<T> = {
  get: () => T
  // Tells the listeners, unless the value is the one already kept.
  set: (value: T) => void
  subscribe: (listener: () => void) => () => void
  // The value, for a component to re-render with.
  use: () => T
}

export function createStore<T>(initial: T): Store<T> {
  const listeners = new Set<() => void>()
  let current = initial

  const get = () => current

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return {
    get,
    set(value) {
      if (Object.is(value, current)) {
        return
      }
      current = value
      listeners.forEach((listener) => listener())
    },
    subscribe,
    use: () => useSyncExternalStore(subscribe, get),
  }
}
