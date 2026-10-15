import type { ReactNode } from 'react'

// A short notice that slides in from the top of the page and goes again by itself, such as what was just added. Errors
// aren't toasts: they stay on the page until the user deals with them.
export type Toast = {
  // Which notice it is, such as "deck added". A toast with the same key replaces the one showing, so repeating an
  // action doesn't stack up copies.
  key: string
  message: ReactNode
  severity: 'success' | 'info'
  // A link to go with it, such as to the deck the cards went in.
  action?: { label: string; to: string }
}

// A toast as it's shown. The id is new each time, so a replaced toast slides in again and has its full time.
export type ShownToast = Toast & { id: number }

// How long a toast shows for, longer when it has a link to follow.
export const toastMs = 6000
export const toastWithActionMs = 10000

// Enough to see what just happened without covering the page.
const maxToasts = 3

const listeners = new Set<() => void>()
let toasts: ShownToast[] = []
let nextId = 1

function update(next: ShownToast[]) {
  toasts = next
  listeners.forEach((listener) => listener())
}

export function showToast(toast: Toast) {
  const shown = { ...toast, id: nextId++ }
  update(
    [...toasts.filter((item) => item.key !== toast.key), shown].slice(
      -maxToasts,
    ),
  )
}

export function dismissToast(id: number) {
  update(toasts.filter((item) => item.id !== id))
}

export function clearToasts() {
  update([])
}

export function getToasts() {
  return toasts
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
