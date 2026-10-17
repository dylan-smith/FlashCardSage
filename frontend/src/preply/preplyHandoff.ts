import { storageKeys } from '../lib/storageKeys'
import { createStore } from '../lib/store'
import type { PreplyWord } from './sendToFlashCardSage'

// The "Send to FlashCardSage" bookmarklet opens FlashCardSage on the Import cards page's Preply tab
// (/import?from=preply), and only takes words from preply.com.
export const preplyTabParam = 'preply'
export const preplyOrigin = 'https://preply.com'

// What the bookmarklet has sent this window: nothing (opened some other way), nothing yet, the user's words, why they
// couldn't be read, or nothing after waiting long enough, such as when the page is reloaded after the words were sent.
export type PreplyHandoff =
  | { status: 'none' }
  | { status: 'waiting' }
  | { status: 'received'; words: PreplyWord[] }
  | { status: 'failed'; message: string }
  | { status: 'timedOut' }

// How long to wait for the words. Reading them from Preply takes a few seconds, even for a long vocabulary.
export const preplyWaitMs = 30_000

const store = createStore<PreplyHandoff>(loadStored())

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
    const stored = sessionStorage.getItem(storageKeys.preplyHandoff)
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
  try {
    if (next.status === 'received') {
      sessionStorage.setItem(
        storageKeys.preplyHandoff,
        JSON.stringify(next.words),
      )
    } else {
      sessionStorage.removeItem(storageKeys.preplyHandoff)
    }
  } catch {
    // The words are still kept for as long as the page is open.
  }
  store.set(next)
}

export const getPreplyHandoff = store.get

export const subscribePreplyHandoff = store.subscribe

// Forgets the words, such as once they've been imported, so the page doesn't offer them again, or stops waiting for
// them when the user gives up.
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
  // A closed Preply tab can't send anything.
  if (!onPreplyTab || opener === null || opener.closed) {
    return
  }

  if (store.get().status !== 'received') {
    update({ status: 'waiting' })
    // The bookmarklet only sends the words once, so a page reloaded or come back to later would wait forever.
    target.setTimeout(() => {
      if (store.get().status === 'waiting') {
        update({ status: 'timedOut' })
      }
    }, preplyWaitMs)
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
