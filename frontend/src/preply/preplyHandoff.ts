import type { PreplyWord } from './sendToFlashCardSage'

// The "Send to FlashCardSage" bookmarklet opens FlashCardSage on the Import cards page's Preply tab
// (/import?from=preply), and only takes words from preply.com.
export const preplyTabParam = 'preply'
export const preplyOrigin = 'https://preply.com'

// What the bookmarklet has sent this window: nothing (opened some other way), nothing yet, the user's words, or why
// they couldn't be read.
export type PreplyHandoff =
  | { status: 'none' }
  | { status: 'waiting' }
  | { status: 'received'; words: PreplyWord[] }
  | { status: 'failed'; message: string }

// Kept for the tab, so the words are still here after the user signs in or reloads the page.
export const preplyHandoffKey = 'flashcardsage.preplyHandoff'

const listeners = new Set<() => void>()
let current: PreplyHandoff = loadStored()

// The words or error in a message from the bookmarklet, or null for anything else.
function parseMessage(data: unknown): PreplyHandoff | null {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const message = data as Record<string, unknown>
  if (
    message.type === 'flashcardsage:preply-error' &&
    typeof message.message === 'string'
  ) {
    return { status: 'failed', message: message.message }
  }
  if (
    message.type === 'flashcardsage:preply-words' &&
    Array.isArray(message.words) &&
    message.words.every(isWord)
  ) {
    return { status: 'received', words: message.words }
  }
  return null
}

function isWord(value: unknown): value is PreplyWord {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const word = value as Record<string, unknown>
  return (
    typeof word.spanish === 'string' &&
    (word.english === null || typeof word.english === 'string') &&
    (word.partOfSpeech === null || typeof word.partOfSpeech === 'string')
  )
}

function loadStored(): PreplyHandoff {
  try {
    const stored = sessionStorage.getItem(preplyHandoffKey)
    if (stored !== null) {
      const words: unknown = JSON.parse(stored)
      if (Array.isArray(words) && words.every(isWord)) {
        return { status: 'received', words }
      }
    }
  } catch {
    // Storage can be turned off, or hold something that isn't ours.
  }
  return { status: 'none' }
}

function update(next: PreplyHandoff) {
  current = next
  try {
    if (next.status === 'received') {
      sessionStorage.setItem(preplyHandoffKey, JSON.stringify(next.words))
    } else {
      sessionStorage.removeItem(preplyHandoffKey)
    }
  } catch {
    // The words are still kept for as long as the page is open.
  }
  listeners.forEach((listener) => listener())
}

export function getPreplyHandoff() {
  return current
}

export function subscribePreplyHandoff(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Forgets the words, such as once they've been imported, so the page doesn't offer them again.
export function clearPreplyHandoff() {
  update({ status: 'none' })
}

// Listens for the bookmarklet's words when this window is the one it opened, and tells it this window is ready.
// Started before the app renders, since the user may need to sign in first, which replaces the page.
export function startPreplyHandoff(target: Window = window) {
  const opener = target.opener as Window | null
  const onPreplyTab =
    target.location.pathname === '/import' &&
    new URLSearchParams(target.location.search).get('from') === preplyTabParam
  if (!onPreplyTab || opener === null) {
    return
  }

  if (current.status !== 'received') {
    update({ status: 'waiting' })
  }
  target.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== preplyOrigin || event.source !== opener) {
      return
    }
    const next = parseMessage(event.data)
    if (next !== null) {
      update(next)
    }
  })
  opener.postMessage({ type: 'flashcardsage:ready' }, preplyOrigin)
}
