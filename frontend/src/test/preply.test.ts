import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import {
  bookmarkletHref,
  sendToFlashCardSage,
} from '../preply/sendToFlashCardSage'

const appOrigin = 'https://flashcardsage.example'
const preply = { hostname: 'preply.com', search: '?subject=spanish' }

// A page of Preply's vocabulary as its GraphQL API answers it.
function vocabularyPage(
  terms: object[],
  next: string | null = null,
): Promise<Response> {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        data: {
          vocabularyBank: {
            vocabularyBank: {
              hasNext: next !== null,
              endCursor: next,
              nodes: terms.map((termDefinition) => ({ termDefinition })),
            },
          },
        },
      }),
    ),
  )
}

const tostado = {
  spelling: 'tostado',
  translation: null,
  definition: {
    translation: { translation: 'toasted' },
    lemma: { typeLabel: 'adjective' },
  },
}

// The import page saying it's ready, as the window the bookmarklet opened. That window is this one in the tests,
// since jsdom only takes a real window as a message's source.
function sayReady(origin = appOrigin) {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source: window,
      data: { type: 'flashcardsage:ready' },
    }),
  )
}

// e2e/preply-import.spec.ts runs it from the bookmark's source in the production build, which catches it using anything
// from outside itself.
describe('the Send to FlashCardSage bookmarklet', () => {
  let open: MockInstance<typeof window.open>
  let posted: MockInstance<typeof window.postMessage>
  let alert: MockInstance<typeof window.alert>

  beforeEach(() => {
    open = vi.spyOn(window, 'open').mockReturnValue(window)
    posted = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads every page of words and sends them once the import page is ready', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => vocabularyPage([tostado], 'cursor-1'))
      .mockImplementationOnce(() =>
        vocabularyPage([
          // The English is on the word itself when the definition has none.
          {
            spelling: 'avena',
            translation: { translation: 'oatmeal' },
            definition: null,
          },
          { spelling: 'gustaron', translation: null, definition: null },
        ]),
      )

    const sending = sendToFlashCardSage(appOrigin, {
      hostname: 'preply.com',
      search: '?subject=french',
    })

    expect(open).toHaveBeenCalledWith(`${appOrigin}/import/preply`)
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2)
    })
    // Nothing is sent before the import page is ready, or by a message from anywhere else.
    sayReady('https://elsewhere.example')
    await Promise.resolve()
    expect(posted).not.toHaveBeenCalled()

    sayReady()
    await sending

    const bodies = fetch.mock.calls.map(
      ([, init]) =>
        JSON.parse(init?.body as string) as {
          variables: { after: string | null; subjectAlias: string }
        },
    )
    expect(bodies.map((body) => body.variables)).toEqual([
      { after: null, subjectAlias: 'french' },
      { after: 'cursor-1', subjectAlias: 'french' },
    ])
    expect(fetch.mock.calls[0][0]).toBe('/graphql/v2/')
    expect(fetch.mock.calls[0][1]?.credentials).toBe('include')
    expect(posted).toHaveBeenCalledWith(
      {
        type: 'flashcardsage:preply-words',
        words: [
          { spanish: 'tostado', english: 'toasted', partOfSpeech: 'adjective' },
          { spanish: 'avena', english: 'oatmeal', partOfSpeech: null },
          { spanish: 'gustaron', english: null, partOfSpeech: null },
        ],
      },
      appOrigin,
    )
  })

  it("sends Preply's error when the words can't be read", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'Not signed in' }] })),
    )

    const sending = sendToFlashCardSage(appOrigin, preply)
    sayReady()
    await sending

    expect(posted).toHaveBeenCalledWith(
      { type: 'flashcardsage:preply-error', message: 'Not signed in' },
      appOrigin,
    )
  })

  it('says to open Preply when clicked anywhere else', async () => {
    await sendToFlashCardSage(appOrigin, {
      hostname: 'example.com',
      search: '',
    })

    expect(alert).toHaveBeenCalledWith(expect.stringContaining('preply.com'))
    expect(open).not.toHaveBeenCalled()
  })

  it('says when the browser blocks the window', async () => {
    open.mockReturnValue(null)
    const fetch = vi.spyOn(globalThis, 'fetch')

    await sendToFlashCardSage(appOrigin, preply)

    expect(alert).toHaveBeenCalledWith(expect.stringContaining('pop-ups'))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is a bookmark that runs it for this FlashCardSage', () => {
    const href = bookmarkletHref(appOrigin)

    expect(href.startsWith('javascript:')).toBe(true)
    const source = decodeURIComponent(href.slice('javascript:'.length))
    expect(source.endsWith(`)("${appOrigin}")`)).toBe(true)
  })
})

describe('receiving the words from Preply', () => {
  const words = [
    { spanish: 'tostado', english: 'toasted', partOfSpeech: 'adjective' },
  ]

  // A fresh copy of the module, since it keeps what it received.
  async function loadHandoff() {
    vi.resetModules()
    return import('../preply/preplyHandoff')
  }

  // The window the bookmarklet opened, with this window as the one that opened it.
  function openedWindow(pathname = '/import/preply') {
    return Object.assign(new EventTarget(), {
      location: { pathname },
      opener: window,
    }) as unknown as Window
  }

  function send(target: Window, data: unknown, origin = 'https://preply.com') {
    target.dispatchEvent(
      new MessageEvent('message', { origin, source: window, data }),
    )
  }

  let posted: MockInstance<typeof window.postMessage>

  beforeEach(() => {
    posted = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
  })

  afterEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('says it is ready and keeps the words Preply sends', async () => {
    const handoff = await loadHandoff()
    const target = openedWindow()
    const listener = vi.fn()
    handoff.subscribePreplyHandoff(listener)

    handoff.startPreplyHandoff(target)

    expect(posted).toHaveBeenCalledWith(
      { type: 'flashcardsage:ready' },
      'https://preply.com',
    )
    expect(handoff.getPreplyHandoff()).toEqual({ status: 'waiting' })

    send(target, { type: 'flashcardsage:preply-words', words })

    expect(handoff.getPreplyHandoff()).toEqual({ status: 'received', words })
    expect(listener).toHaveBeenCalled()
    // Kept for the tab, so they're still there after signing in or reloading.
    expect((await loadHandoff()).getPreplyHandoff()).toEqual({
      status: 'received',
      words,
    })
  })

  it("keeps Preply's error", async () => {
    const handoff = await loadHandoff()
    const target = openedWindow()
    handoff.startPreplyHandoff(target)

    send(target, {
      type: 'flashcardsage:preply-error',
      message: 'Not signed in',
    })

    expect(handoff.getPreplyHandoff()).toEqual({
      status: 'failed',
      message: 'Not signed in',
    })
  })

  it('ignores anything that is not the bookmarklet', async () => {
    const handoff = await loadHandoff()
    const target = openedWindow()
    handoff.startPreplyHandoff(target)

    send(
      target,
      { type: 'flashcardsage:preply-words', words },
      'https://evil.example',
    )
    send(target, {
      type: 'flashcardsage:preply-words',
      words: [{ spanish: 1 }],
    })
    send(target, 'hello')
    target.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://preply.com',
        source: null,
        data: { type: 'flashcardsage:preply-words', words },
      }),
    )

    expect(handoff.getPreplyHandoff()).toEqual({ status: 'waiting' })
  })

  it('does nothing unless the bookmarklet opened the import page', async () => {
    const handoff = await loadHandoff()
    const elsewhere = openedWindow('/import')
    const notOpened = Object.assign(openedWindow(), { opener: null })

    handoff.startPreplyHandoff(elsewhere)
    handoff.startPreplyHandoff(notOpened)

    expect(posted).not.toHaveBeenCalled()
    expect(handoff.getPreplyHandoff()).toEqual({ status: 'none' })
  })

  it('forgets the words once cleared', async () => {
    const handoff = await loadHandoff()
    const target = openedWindow()
    handoff.startPreplyHandoff(target)
    send(target, { type: 'flashcardsage:preply-words', words })

    handoff.clearPreplyHandoff()

    expect(handoff.getPreplyHandoff()).toEqual({ status: 'none' })
    expect(sessionStorage.getItem(handoff.preplyHandoffKey)).toBeNull()
  })
})
