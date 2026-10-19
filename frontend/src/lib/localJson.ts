// JSON kept in localStorage, such as the cards practice runs from offline. Storage can be unavailable (for example in a
// private window) or full, and what's stored can be from an older version of the app, so none of these throw.

// What's stored under key, or null when there's nothing, it can't be read, or it isn't what isValid expects.
export function readJson<T>(
  key: string,
  isValid: (value: unknown) => value is T,
): T | null {
  try {
    const stored = localStorage.getItem(key)
    if (stored === null) {
      return null
    }
    const value = JSON.parse(stored) as unknown
    return isValid(value) ? value : null
  } catch {
    return null
  }
}

// Stores value under key, and returns whether it was stored.
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeJson(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable, in which case there's nothing to remove.
  }
}
