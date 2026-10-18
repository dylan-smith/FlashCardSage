import { storageKeys } from '../lib/storageKeys'
import { createStore } from '../lib/store'
import { wordSourceFrom } from './wordSources'
import type { SourceWord, WordSource, WordSourceId } from './wordSources'

// A site's "Send to FlashCardSage" bookmarklet opens FlashCardSage on the Import cards page's tab for that site
// (/import?from=<source id>), and the page only takes words from that site. Its messages are named for the site:
// flashcardsage:<source id>-words with the words, or flashcardsage:<source id>-error saying why there aren't any.

// What a bookmarklet has sent this window: nothing (opened some other way), nothing yet, the user's words, why they
// couldn't be read, or nothing after waiting long enough, such as when the page is reloaded after the words were sent.
export type Handoff =
  | { status: 'none' }
  | { status: 'waiting'; source: WordSourceId }
  | { status: 'received'; source: WordSourceId; words: SourceWord[] }
  | { status: 'failed'; source: WordSourceId; message: string }
  | { status: 'timedOut'; source: WordSourceId }

// How long to wait for the words. Reading them from the site takes a few seconds, even for a long list.
export const handoffWaitMs = 30_000

const store = createStore<Handoff>(loadStored())

// The words or error in a message from the source's bookmarklet, or null for anything else.
function parseMessage(source: WordSource, data: unknown): Handoff | null {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const message = data as Record<string, unknown>
  if (
    message.type === `flashcardsage:${source.id}-error` &&
    typeof message.message === 'string'
  ) {
    return { status: 'failed', source: source.id, message: message.message }
  }
  if (
    message.type === `flashcardsage:${source.id}-words` &&
    Array.isArray(message.words)
  ) {
    const words = message.words.map(toWord)
    if (words.every((word) => word !== null)) {
      return { status: 'received', source: source.id, words }
    }
  }
  return null
}

// A word as a bookmarklet sends it, with its English as one word or none (Preply) or a list (Duolingo), as a
// SourceWord, or null if it's not a word at all.
function toWord(value: unknown): SourceWord | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const word = value as Record<string, unknown>
  if (typeof word.spanish !== 'string') {
    return null
  }
  if (word.english === null) {
    return { spanish: word.spanish, english: [] }
  }
  if (typeof word.english === 'string') {
    return { spanish: word.spanish, english: [word.english] }
  }
  if (
    Array.isArray(word.english) &&
    word.english.every((text) => typeof text === 'string')
  ) {
    return { spanish: word.spanish, english: word.english }
  }
  return null
}

function loadStored(): Handoff {
  try {
    const stored = sessionStorage.getItem(storageKeys.wordHandoff)
    if (stored !== null) {
      const { source, words } = JSON.parse(stored) as Record<string, unknown>
      if (typeof source === 'string' && Array.isArray(words)) {
        const id = wordSourceFrom(source)?.id
        const parsed = words.map(toWord)
        if (id !== undefined && parsed.every((word) => word !== null)) {
          return { status: 'received', source: id, words: parsed }
        }
      }
    }
  } catch {
    // Storage can be turned off, or hold something that isn't ours.
  }
  return { status: 'none' }
}

function update(next: Handoff) {
  try {
    if (next.status === 'received') {
      sessionStorage.setItem(
        storageKeys.wordHandoff,
        JSON.stringify({ source: next.source, words: next.words }),
      )
    } else {
      sessionStorage.removeItem(storageKeys.wordHandoff)
    }
  } catch {
    // The words are still kept for as long as the page is open.
  }
  store.set(next)
}

export const getHandoff = store.get

export const subscribeHandoff = store.subscribe

// Forgets the words, such as once they've been imported, so the page doesn't offer them again, or stops waiting for
// them when the user gives up.
export function clearHandoff() {
  update({ status: 'none' })
}

// Listens for a bookmarklet's words when this window is the one it opened, and tells it this window is ready.
// Started before the app renders, since the user may need to sign in first, which replaces the page.
export function startHandoff(target: Window = window) {
  const opener = target.opener as Window | null
  const source =
    target.location.pathname === '/import'
      ? wordSourceFrom(new URLSearchParams(target.location.search).get('from'))
      : null
  // A closed tab of the site can't send anything.
  if (source === null || opener === null || opener.closed) {
    return
  }

  const current = store.get()
  if (current.status !== 'received' || current.source !== source.id) {
    update({ status: 'waiting', source: source.id })
    // The bookmarklet only sends the words once, so a page reloaded or come back to later would wait forever.
    target.setTimeout(() => {
      if (store.get().status === 'waiting') {
        update({ status: 'timedOut', source: source.id })
      }
    }, handoffWaitMs)
  }
  target.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== source.origin || event.source !== opener) {
      return
    }
    const next = parseMessage(source, event.data)
    if (next !== null) {
      update(next)
    }
  })
  opener.postMessage({ type: 'flashcardsage:ready' }, source.origin)
}
