import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { maxWordsPerSide } from '../api/flashCards'
import { duolingoGroups } from '../duolingo/duolingoCards'
import {
  duolingoBookmarkletHref,
  sendDuolingoToFlashCardSage,
} from '../duolingo/sendToFlashCardSage'

const appOrigin = 'https://flashcardsage.example'
const duolingo = { hostname: 'www.duolingo.com' }

// Duolingo's sign-in token, as its cookie holds it: a JWT whose claims name the user.
function signIn(sub: unknown = 377403869) {
  const claims = btoa(JSON.stringify({ sub }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  document.cookie = `jwt_token=header.${claims}.signature`
}

function signOut() {
  document.cookie = 'jwt_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

// The user's course as Duolingo's API answers it: Spanish from English, with a path of skills at these levels. Each
// level's skill, state and sessions, with a second level of the first skill, which Duolingo's own page doesn't count.
function course(
  levels: { skill: string; state: string; finishedSessions: number }[],
  learningLanguage = 'es',
  fromLanguage = 'en',
) {
  return {
    currentCourse: {
      learningLanguage,
      fromLanguage,
      pathSectioned: [
        {
          units: [
            {
              levels: levels.map(({ skill, state, finishedSessions }) => ({
                state,
                finishedSessions,
                pathLevelMetadata: { skillId: skill },
              })),
            },
          ],
        },
      ],
    },
  }
}

// A page of the user's learned words as Duolingo's API answers it.
function lexemes(
  words: { text: string; translations: string[] }[],
  nextStartIndex: number | null = null,
) {
  return {
    learnedLexemes: words.map((word) => ({
      ...word,
      audioURL: 'https://example.com/audio',
      isNew: false,
    })),
    pagination: { totalLexemes: 3, nextStartIndex },
  }
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

// e2e/duolingo-import.spec.ts runs it from the bookmark's source in the production build, which catches it using
// anything from outside itself.
describe('the Send to FlashCardSage bookmarklet for Duolingo', () => {
  let open: MockInstance<typeof window.open>
  let posted: MockInstance<typeof window.postMessage>
  let alert: MockInstance<typeof window.alert>

  beforeEach(() => {
    open = vi.spyOn(window, 'open').mockReturnValue(window)
    posted = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    signIn()
  })

  afterEach(() => {
    signOut()
    vi.restoreAllMocks()
  })

  it('reads every page of words and sends them once the import page is ready', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() =>
        json(
          course([
            { skill: 'cafe', state: 'legendary', finishedSessions: 4 },
            { skill: 'cafe', state: 'passed', finishedSessions: 4 },
            { skill: 'travel', state: 'active', finishedSessions: 1 },
            { skill: 'family', state: 'locked', finishedSessions: 0 },
          ]),
        ),
      )
      .mockImplementationOnce(() =>
        json(
          lexemes(
            [
              { text: 'a', translations: ['to', 'at'] },
              { text: 'avena', translations: ['oatmeal'] },
            ],
            2,
          ),
        ),
      )
      .mockImplementationOnce(() =>
        json(lexemes([{ text: 'gustaron', translations: [] }])),
      )

    const sending = sendDuolingoToFlashCardSage(appOrigin, duolingo)

    expect(open).toHaveBeenCalledWith(`${appOrigin}/import?from=duolingo`)
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(3)
    })
    // Nothing is sent before the import page is ready, or by a message from anywhere else.
    sayReady('https://elsewhere.example')
    await Promise.resolve()
    expect(posted).not.toHaveBeenCalled()

    sayReady()
    await sending

    // The user's course, with their sign-in, then their words, with how far along the course they are as Duolingo's
    // own page sends it: each skill's first level, unless it's locked.
    const [user, firstPage, secondPage] = fetch.mock.calls
    expect(user[0]).toBe('/2017-06-30/users/377403869?fields=currentCourse')
    expect(user[1]?.headers).toMatchObject({
      Authorization: 'Bearer header.eyJzdWIiOjM3NzQwMzg2OX0.signature',
    })
    expect(firstPage[0]).toBe(
      '/2017-06-30/users/377403869/courses/es/en/learned-lexemes?limit=500&sortBy=ALPHABETICAL&startIndex=0',
    )
    expect(secondPage[0]).toMatch(/startIndex=2$/)
    expect(firstPage[1]?.method).toBe('POST')
    expect(JSON.parse(firstPage[1]?.body as string)).toEqual({
      lastTotalLexemeCount: 0,
      progressedSkills: [
        { finishedLevels: 1, finishedSessions: 4, skillId: { id: 'cafe' } },
        { finishedLevels: 0, finishedSessions: 1, skillId: { id: 'travel' } },
      ],
    })
    expect(posted).toHaveBeenCalledWith(
      {
        type: 'flashcardsage:duolingo-words',
        words: [
          { spanish: 'a', english: ['to', 'at'] },
          { spanish: 'avena', english: ['oatmeal'] },
          { spanish: 'gustaron', english: [] },
        ],
      },
      appOrigin,
    )
  })

  it('says to switch to the Spanish course when learning something else', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() =>
      json(course([], 'fr', 'en')),
    )

    const sending = sendDuolingoToFlashCardSage(appOrigin, duolingo)
    sayReady()
    await sending

    expect(posted).toHaveBeenCalledWith(
      {
        type: 'flashcardsage:duolingo-error',
        message: expect.stringContaining('Spanish from English') as string,
      },
      appOrigin,
    )
  })

  it("sends Duolingo's error when the words can't be read", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() =>
      json({ error: 'Unauthorized' }, 401),
    )

    const sending = sendDuolingoToFlashCardSage(appOrigin, duolingo)
    sayReady()
    await sending

    expect(posted).toHaveBeenCalledWith(
      {
        type: 'flashcardsage:duolingo-error',
        message: 'Duolingo answered with an error (401).',
      },
      appOrigin,
    )
  })

  it('says to sign in when there is no sign-in to use', async () => {
    signOut()
    const fetch = vi.spyOn(globalThis, 'fetch')

    const sending = sendDuolingoToFlashCardSage(appOrigin, duolingo)
    sayReady()
    await sending

    expect(fetch).not.toHaveBeenCalled()
    expect(posted).toHaveBeenCalledWith(
      {
        type: 'flashcardsage:duolingo-error',
        message: expect.stringContaining('not signed in') as string,
      },
      appOrigin,
    )
  })

  it('says to open Duolingo when clicked anywhere else', async () => {
    await sendDuolingoToFlashCardSage(appOrigin, { hostname: 'example.com' })

    expect(alert).toHaveBeenCalledWith(expect.stringContaining('duolingo.com'))
    expect(open).not.toHaveBeenCalled()
  })

  it('says when the browser blocks the window', async () => {
    open.mockReturnValue(null)
    const fetch = vi.spyOn(globalThis, 'fetch')

    await sendDuolingoToFlashCardSage(appOrigin, duolingo)

    expect(alert).toHaveBeenCalledWith(expect.stringContaining('pop-ups'))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is a bookmark that runs it for this FlashCardSage', () => {
    const href = duolingoBookmarkletHref(appOrigin)

    expect(href).toMatch(/^javascript:/)
    const source = decodeURIComponent(href.slice('javascript:'.length))
    expect(source).toMatch(/\)\("https:\/\/flashcardsage\.example"\)$/)
    expect(source).toContain('/import?from=duolingo')
  })
})

describe('making cards from Duolingo words', () => {
  it('gives each word a card with its English, each English word on the first card that has it', () => {
    expect(
      duolingoGroups([
        { spanish: 'a', english: ['to', 'at', 'for'] },
        { spanish: 'para', english: ['For', 'in order to'] },
        { spanish: 'por', english: ['for'] },
      ]),
    ).toEqual([
      { spanish: ['a'], english: ['to', 'at', 'for'], wordCount: 1 },
      { spanish: ['para'], english: ['in order to'], wordCount: 1 },
    ])
  })

  it('leaves out words with no English, and puts a word that comes again on one card', () => {
    expect(
      duolingoGroups([
        { spanish: 'gustaron', english: [] },
        { spanish: 'picante', english: ['spicy'] },
        { spanish: 'Picante', english: ['hot', 'Spicy'] },
      ]),
    ).toEqual([
      { spanish: ['picante'], english: ['spicy', 'hot'], wordCount: 2 },
    ])
  })

  it('keeps the first of too many English words, leaving the rest for other words', () => {
    const many = Array.from({ length: maxWordsPerSide + 1 }, (_, index) =>
      String(index),
    )

    expect(
      duolingoGroups([
        { spanish: 'muchos', english: many },
        { spanish: 'último', english: [String(maxWordsPerSide)] },
      ]),
    ).toEqual([
      { spanish: ['muchos'], english: many.slice(0, -1), wordCount: 1 },
      { spanish: ['último'], english: [String(maxWordsPerSide)], wordCount: 1 },
    ])
  })
})
