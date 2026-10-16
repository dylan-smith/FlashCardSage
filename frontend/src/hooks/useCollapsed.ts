import { useState } from 'react'

function readCollapsed(key: string) {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function storeCollapsed(key: string, collapsed: boolean) {
  try {
    if (collapsed) {
      localStorage.setItem(key, 'true')
    } else {
      localStorage.removeItem(key)
    }
  } catch {
    // Storage can be unavailable, for example in a private window. The choice still lasts until the page reloads.
  }
}

// Whether a section is collapsed, and a function that toggles it. Kept in localStorage under key so the section stays
// collapsed across reloads once the user collapses it.
export function useCollapsed(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(key))

  function toggle() {
    storeCollapsed(key, !collapsed)
    setCollapsed(!collapsed)
  }

  return [collapsed, toggle]
}
