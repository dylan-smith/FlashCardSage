import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { maxWordsPerSide } from '../api/flashCards'
import { groupWords } from '../preply/groupWords'
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

    expect(open).toHaveBeenCalledWith(`${appOrigin}/import?from=preply`)
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

    expect(href).toMatch(/^javascript:/)
    const source = decodeURIComponent(href.slice('javascript:'.length))
    expect(source).toMatch(/\)\("https:\/\/flashcardsage\.example"\)$/)
  })
})

describe('receiving the words from Preply', () => {
  const words = [
    { spanish: 'tostado', english: 'toasted', partOfSpeech: 'adjective' },
  ]
  // As the import page keeps them, whichever site they're from.
  const received = [{ spanish: 'tostado', english: ['toasted'] }]

  // A fresh copy of the module, since it keeps what it received.
  async function loadHandoff() {
    vi.resetModules()
    return import('../wordSources/handoff')
  }

  // The window the bookmarklet opened, with this window as the one that opened it.
  function openedWindow(pathname = '/import', search = '?from=preply') {
    return Object.assign(new EventTarget(), {
      location: { pathname, search },
      opener: window,
      // This window's, so a test can use fake timers.
      setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
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
    handoff.subscribeHandoff(listener)

    handoff.startHandoff(target)

    expect(posted).toHaveBeenCalledWith(
      { type: 'flashcardsage:ready' },
      'https://preply.com',
    )
    expect(handoff.getHandoff()).toEqual({
      status: 'waiting',
      source: 'preply',
    })

    send(target, { type: 'flashcardsage:preply-words', words })

    expect(handoff.getHandoff()).toEqual({
      status: 'received',
      source: 'preply',
      words: received,
    })
    expect(listener).toHaveBeenCalled()
    // Kept for the tab, so they're still there after signing in or reloading.
    expect((await loadHandoff()).getHandoff()).toEqual({
      status: 'received',
      source: 'preply',
      words: received,
    })
  })

  it("keeps Preply's error", async () => {
    const handoff = await loadHandoff()
    const target = openedWindow()
    handoff.startHandoff(target)

    send(target, {
      type: 'flashcardsage:preply-error',
      message: 'Not signed in',
    })

    expect(handoff.getHandoff()).toEqual({
      status: 'failed',
      source: 'preply',
      message: 'Not signed in',
    })
  })

  it('ignores anything that is not the bookmarklet', async () => {
    const handoff = await loadHandoff()
    const target = openedWindow()
    handoff.startHandoff(target)

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

    expect(handoff.getHandoff()).toEqual({
      status: 'waiting',
      source: 'preply',
    })
  })

  it('does nothing unless the bookmarklet opened the import page', async () => {
    const handoff = await loadHandoff()
    const elsewhere = openedWindow('/import', '?from=document')
    const notOpened = Object.assign(openedWindow(), { opener: null })

    // The Preply tab that opened it was closed since, so nothing can come.
    const openerClosed = Object.assign(openedWindow(), {
      opener: { closed: true, postMessage: vi.fn() },
    })

    handoff.startHandoff(elsewhere)
    handoff.startHandoff(notOpened)
    handoff.startHandoff(openerClosed)

    expect(posted).not.toHaveBeenCalled()
    expect(handoff.getHandoff()).toEqual({ status: 'none' })
  })

  // Such as the page reloaded, or come back to later, after the bookmarklet sent the words, which it only does once.
  it('stops waiting when no words come', async () => {
    vi.useFakeTimers()
    try {
      const handoff = await loadHandoff()
      handoff.startHandoff(openedWindow())

      vi.advanceTimersByTime(handoff.handoffWaitMs - 1)
      expect(handoff.getHandoff()).toEqual({
        status: 'waiting',
        source: 'preply',
      })
      vi.advanceTimersByTime(1)

      expect(handoff.getHandoff()).toEqual({
        status: 'timedOut',
        source: 'preply',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the words that came in time', async () => {
    vi.useFakeTimers()
    try {
      const handoff = await loadHandoff()
      const target = openedWindow()
      handoff.startHandoff(target)
      send(target, { type: 'flashcardsage:preply-words', words })

      vi.advanceTimersByTime(handoff.handoffWaitMs)

      expect(handoff.getHandoff()).toEqual({
        status: 'received',
        source: 'preply',
        words: received,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('forgets the words once cleared', async () => {
    const handoff = await loadHandoff()
    const target = openedWindow()
    handoff.startHandoff(target)
    send(target, { type: 'flashcardsage:preply-words', words })

    handoff.clearHandoff()

    expect(handoff.getHandoff()).toEqual({ status: 'none' })
    expect(sessionStorage.getItem(handoff.handoffKey)).toBeNull()
  })
})

describe('grouping Preply words into cards', () => {
  // A Preply word as the import page keeps it, with its English or none.
  function word(spanish: string, english: string | null) {
    return { spanish, english: english === null ? [] : [english] }
  }

  it('puts words with the same English on one card', () => {
    expect(
      groupWords([
        word('tostado', 'toasted'),
        word('avena', 'oatmeal'),
        word('tostada', 'Toasted'),
      ]),
    ).toEqual([
      { spanish: ['tostado', 'tostada'], english: ['toasted'], wordCount: 2 },
      { spanish: ['avena'], english: ['oatmeal'], wordCount: 1 },
    ])
  })

  it('puts a Spanish word with two English words on one card', () => {
    expect(
      groupWords([word('picante', 'spicy'), word('Picante', 'hot')]),
    ).toEqual([
      { spanish: ['picante'], english: ['spicy', 'hot'], wordCount: 2 },
    ])
  })

  // picantes shares "spicy" with the last word, which shares its Spanish with the third, which shares "hot" with
  // caliente.
  it('joins words linked through another word', () => {
    expect(
      groupWords([
        word('picantes', 'spicy'),
        word('caliente', 'hot'),
        word('picante', 'hot'),
        word('picante', 'spicy'),
      ]),
    ).toEqual([
      {
        spanish: ['picantes', 'caliente', 'picante'],
        english: ['spicy', 'hot'],
        wordCount: 4,
      },
    ])
  })

  it('leaves out words with no English, and words past a side’s limit', () => {
    const many = Array.from({ length: maxWordsPerSide + 2 }, (_, index) =>
      word(`tostado ${index}`, 'toasted'),
    )

    const [group, ...rest] = groupWords([word('gustaron', null), ...many])

    expect(rest).toEqual([])
    expect(group.spanish).toHaveLength(maxWordsPerSide)
    expect(group.wordCount).toBe(maxWordsPerSide + 2)
  })
})
