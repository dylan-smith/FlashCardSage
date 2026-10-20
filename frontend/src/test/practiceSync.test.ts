import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPreferences } from '../api/preferences'
import type { PracticePack, PracticeResultToSync } from '../api/practice'
import { getSession, setSession } from '../auth/session'
import { setPreferences } from '../hooks/usePreferences'
import { storageKeys, userStorageKey } from '../lib/storageKeys'
import {
  loadPracticePack,
  readStoredPack,
  refreshPack,
  selectCards,
  storedChoices,
  withPendingAnswers,
  writeStoredPack,
} from '../practice/pack'
import { cachePictures } from '../practice/pictures'
import { enqueueResult, pendingCount, readQueue } from '../practice/queue'
import {
  startPracticeSync,
  stopPracticeSync,
  syncPracticeResults,
  syncStatus,
} from '../practice/sync'
import { trackException } from '../telemetry'
import { deck, packCard, pets, tag } from './support/factories'
import {
  emptyResponse,
  jsonResponse,
  mockApi,
  unreachable,
} from './support/mockApi'
import type { Call } from './support/mockApi'

vi.mock('../practice/pictures', () => ({ cachePictures: vi.fn() }))

const subject = 'test:tester'

const cat = packCard(1, 'el gato', 'the cat', { tagIds: [pets.id] })
const dog = packCard(2, 'el perro', 'the dog')
const house = packCard(3, 'la casa', 'the house', { tagIds: [pets.id] })

const pack: PracticePack = {
  cards: [cat, dog, house],
  decks: [deck(7, 'Week 1', [house.id, cat.id])],
  tags: [pets],
}

// Queues a Got it! answer for a card, given that many seconds after 10:00.
function answer(flashCardId = cat.id, seconds = 0) {
  return enqueueResult(
    subject,
    flashCardId,
    'GotIt',
    new Date(Date.UTC(2026, 9, 19, 10, 0, seconds)).toISOString(),
  )
}

// The answers sent in a sync request.
function sent(call: Call) {
  return (call.body as { results: PracticeResultToSync[] }).results
}

function goOffline() {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
}

beforeEach(() => {
  setSession({ token: 'test:Tester', name: 'Tester', provider: 'test' })
})

afterEach(() => {
  stopPracticeSync()
  setSession(null)
  setPreferences(null)
  localStorage.clear()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('the answers kept on the device', () => {
  it('keeps them apart for each user', () => {
    const result = answer()

    expect(readQueue(subject)).toEqual([result])
    expect(readQueue('test:someone else')).toEqual([])
    expect(
      localStorage.getItem(
        userStorageKey(storageKeys.practiceQueue, 'test:tester'),
      ),
    ).toBe(JSON.stringify([result]))
  })

  it('gives each answer its own id', () => {
    const first = answer()
    const second = answer()

    expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(second.id).not.toBe(first.id)
  })

  it("throws when an answer can't be kept", () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => answer()).toThrow(
      'The answer could not be kept on this device.',
    )
  })

  it("ignores what's stored when it isn't a list of answers", () => {
    localStorage.setItem(
      userStorageKey(storageKeys.practiceQueue, subject),
      '{"not":"a queue"}',
    )

    expect(readQueue(subject)).toEqual([])
  })
})

describe('syncing answers', () => {
  it('sends them oldest first in batches of 100, and forgets them once saved', async () => {
    const results = Array.from({ length: 150 }, (_, index) =>
      answer(cat.id, index),
    )
    const { calls } = mockApi({
      'POST /flashcards/practice-results': { accepted: 0 },
    })

    await syncPracticeResults()

    const posts = calls.filter('POST', '/flashcards/practice-results')
    expect(posts.map(sent)).toEqual([results.slice(0, 100), results.slice(100)])
    expect(readQueue(subject)).toEqual([])
    expect(syncStatus.get()).toEqual({ pending: 0, failed: false })
  })

  it('keeps an answer given while a batch was being sent', async () => {
    const first = answer(cat.id, 0)
    let later: PracticeResultToSync | undefined
    const { calls } = mockApi({
      'POST /flashcards/practice-results': () => {
        if (later !== undefined) {
          return unreachable()
        }
        later = answer(dog.id, 1)
        return jsonResponse({ accepted: 0 })
      },
    })

    await syncPracticeResults()

    const posts = calls.filter('POST', '/flashcards/practice-results')
    expect(posts.map(sent)).toEqual([[first], [later]])
    expect(readQueue(subject)).toEqual([later])
    expect(syncStatus.get()).toEqual({ pending: 1, failed: false })
  })

  it("keeps the answers quietly when the API can't be reached", async () => {
    const result = answer()
    mockApi({ 'POST /flashcards/practice-results': unreachable })

    await syncPracticeResults()

    expect(readQueue(subject)).toEqual([result])
    expect(syncStatus.get()).toEqual({ pending: 1, failed: false })
    expect(trackException).not.toHaveBeenCalled()
  })

  it("doesn't send anything while the browser is offline", async () => {
    answer()
    goOffline()
    const { calls } = mockApi()

    await syncPracticeResults()

    expect(calls.all).toEqual([])
    expect(syncStatus.get()).toEqual({ pending: 1, failed: false })
  })

  it('keeps the answers for the next sign-in when the sign-in has expired', async () => {
    const result = answer()
    mockApi({ 'POST /flashcards/practice-results': emptyResponse(401) })

    await syncPracticeResults()

    expect(getSession()).toBeNull()
    expect(readQueue(subject)).toEqual([result])
    expect(trackException).not.toHaveBeenCalled()
  })

  it("drops and reports a batch the API won't take, and goes on with the rest", async () => {
    const results = Array.from({ length: 101 }, (_, index) =>
      answer(cat.id, index),
    )
    const { calls } = mockApi({
      'POST /flashcards/practice-results': (call: Call) =>
        sent(call).length === 100
          ? emptyResponse(400)
          : jsonResponse({ accepted: 0 }),
    })

    await syncPracticeResults()

    const posts = calls.filter('POST', '/flashcards/practice-results')
    expect(posts.map(sent)).toEqual([results.slice(0, 100), results.slice(100)])
    expect(readQueue(subject)).toEqual([])
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'syncPracticeResults',
    })
  })

  it('reports another failure, keeps the answers and says they failed', async () => {
    const result = answer()
    mockApi({ 'POST /flashcards/practice-results': emptyResponse(500) })

    await syncPracticeResults()

    expect(readQueue(subject)).toEqual([result])
    expect(syncStatus.get()).toEqual({ pending: 1, failed: true })
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'syncPracticeResults',
    })
  })

  it('clears the failure once the answers are saved', async () => {
    answer()
    const { routes } = mockApi({
      'POST /flashcards/practice-results': emptyResponse(500),
    })
    await syncPracticeResults()
    routes['POST /flashcards/practice-results'] = { accepted: 0 }

    await syncPracticeResults()

    expect(syncStatus.get()).toEqual({ pending: 0, failed: false })
  })

  it('sends the answers once when it is asked to sync again meanwhile', async () => {
    answer()
    const { calls } = mockApi({
      'POST /flashcards/practice-results': { accepted: 1 },
      'GET /flashcards/practice/pack': pack,
    })

    const first = syncPracticeResults()
    const second = syncPracticeResults()
    await Promise.all([first, second])

    expect(second).toBe(first)
    expect(calls.filter('POST', '/flashcards/practice-results')).toHaveLength(1)
  })

  it('loads the pack again once answers are saved', async () => {
    answer()
    const { calls, background } = mockApi({
      'POST /flashcards/practice-results': { accepted: 1 },
      'GET /flashcards/practice/pack': () => {
        // Only once the answers are saved.
        expect(calls.some('POST', '/flashcards/practice-results')).toBe(true)
        return jsonResponse(pack)
      },
    })

    await syncPracticeResults()

    expect(background.filter('GET', '/flashcards/practice/pack')).toHaveLength(
      1,
    )
    expect(readStoredPack(subject)).toEqual(pack)
  })

  it("doesn't load the pack again when the API already had every answer", async () => {
    answer()
    const { background } = mockApi({
      'POST /flashcards/practice-results': { accepted: 0 },
    })

    await syncPracticeResults()

    expect(background.some('GET', '/flashcards/practice/pack')).toBe(false)
  })

  it('does nothing when no one is signed in', async () => {
    answer()
    setSession(null)
    const { calls } = mockApi()

    await syncPracticeResults()

    expect(calls.all).toEqual([])
  })
})

describe('starting to sync', () => {
  it('syncs straight away, and again when the browser comes back online', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    writeStoredPack(subject, pack)
    const result = answer()
    const { calls } = mockApi({
      'POST /flashcards/practice-results': { accepted: 0 },
    })

    startPracticeSync()
    await syncPracticeResults()
    expect(syncStatus.get()).toEqual({ pending: 1, failed: false })
    expect(calls.all).toEqual([])

    onLine.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await syncPracticeResults()

    expect(
      calls.filter('POST', '/flashcards/practice-results').map(sent),
    ).toEqual([[result]])
    expect(syncStatus.get()).toEqual({ pending: 0, failed: false })
  })

  it('stops syncing when the browser comes back online once stopped', async () => {
    writeStoredPack(subject, pack)
    answer()
    const { calls } = mockApi({
      'POST /flashcards/practice-results': unreachable,
    })
    startPracticeSync()
    await syncPracticeResults()

    stopPracticeSync()
    window.dispatchEvent(new Event('online'))
    await syncPracticeResults()

    expect(calls.filter('POST', '/flashcards/practice-results')).toHaveLength(2)
    expect(syncStatus.get()).toEqual({ pending: 1, failed: false })
  })

  it('only starts once', async () => {
    writeStoredPack(subject, pack)
    answer()
    const { calls } = mockApi({
      'POST /flashcards/practice-results': unreachable,
    })

    startPracticeSync()
    startPracticeSync()
    await syncPracticeResults()
    window.dispatchEvent(new Event('online'))
    await syncPracticeResults()

    // Once from starting, which the second start shares, and once from the 'online' event.
    expect(calls.filter('POST', '/flashcards/practice-results')).toHaveLength(2)
  })

  it('loads the pack when there is none on the device', async () => {
    const { background } = mockApi({ 'GET /flashcards/practice/pack': pack })

    startPracticeSync()

    await vi.waitFor(() => expect(readStoredPack(subject)).toEqual(pack))
    expect(background.filter('GET', '/flashcards/practice/pack')).toHaveLength(
      1,
    )
  })

  it("doesn't load the pack when there is one on the device", async () => {
    writeStoredPack(subject, pack)
    const { calls, background } = mockApi()

    startPracticeSync()
    await syncPracticeResults()

    expect([...calls.all, ...background.all]).toEqual([])
  })
})

describe('the practice pack', () => {
  const stored: PracticePack = { cards: [dog], decks: [], tags: [] }

  it('is loaded from the API and kept on the device for the user', async () => {
    writeStoredPack(subject, stored)
    mockApi({ 'GET /flashcards/practice/pack': pack })

    expect(await loadPracticePack(subject)).toEqual(pack)
    expect(readStoredPack(subject)).toEqual(pack)
    expect(readStoredPack('test:someone else')).toBeNull()
  })

  it("comes from the device quietly when the API can't be reached", async () => {
    writeStoredPack(subject, stored)
    mockApi({ 'GET /flashcards/practice/pack': unreachable })

    expect(await loadPracticePack(subject)).toEqual(stored)
    expect(trackException).not.toHaveBeenCalled()
  })

  it('comes from the device when the API fails, and the failure is reported', async () => {
    writeStoredPack(subject, stored)
    mockApi({ 'GET /flashcards/practice/pack': emptyResponse(500) })

    expect(await loadPracticePack(subject)).toEqual(stored)
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'practicePack',
    })
  })

  it('comes from the device without asking the API while offline', async () => {
    writeStoredPack(subject, stored)
    goOffline()
    const { calls, background } = mockApi()

    expect(await loadPracticePack(subject)).toEqual(stored)
    expect([...calls.all, ...background.all]).toEqual([])
  })

  it("is null when there's none on the device and the API can't be reached", async () => {
    mockApi({ 'GET /flashcards/practice/pack': unreachable })

    expect(await loadPracticePack(subject)).toBeNull()
  })

  it("is null when there's none on the device while offline", async () => {
    goOffline()
    mockApi()

    expect(await loadPracticePack(subject)).toBeNull()
  })

  it("throws when there's none on the device and the API fails", async () => {
    mockApi({ 'GET /flashcards/practice/pack': emptyResponse(500) })

    await expect(loadPracticePack(subject)).rejects.toThrow(
      'Unable to load flash cards.',
    )
  })

  it('throws when the load is cancelled, even with one on the device', async () => {
    writeStoredPack(subject, stored)
    const controller = new AbortController()
    mockApi({
      'GET /flashcards/practice/pack': () => {
        controller.abort()
        return unreachable()
      },
    })

    await expect(loadPracticePack(subject, controller.signal)).rejects.toThrow(
      TypeError,
    )
  })

  it("keeps the cards' pictures while the user has pictures on", async () => {
    setPreferences(defaultPreferences)
    mockApi({ 'GET /flashcards/practice/pack': pack })

    await refreshPack(subject)

    expect(cachePictures).toHaveBeenCalledWith(pack)
  })

  it("doesn't keep the cards' pictures while the user has pictures off", async () => {
    setPreferences({ ...defaultPreferences, showPictures: false })
    mockApi({ 'GET /flashcards/practice/pack': pack })

    await refreshPack(subject)

    expect(cachePictures).not.toHaveBeenCalled()
  })

  it('has the answers not saved yet applied to its cards, oldest first', () => {
    const scoredCat = { ...cat, score: 80 }
    const queue: PracticeResultToSync[] = [
      {
        id: 'a',
        flashCardId: cat.id,
        outcome: 'GotIt',
        practicedAt: '2026-10-19T10:00:00Z',
      },
      {
        id: 'b',
        flashCardId: cat.id,
        outcome: 'GotIt',
        practicedAt: '2026-10-19T10:01:00Z',
      },
      {
        id: 'c',
        flashCardId: dog.id,
        outcome: 'Failed',
        practicedAt: '2026-10-19T10:02:00Z',
      },
      // A card that's gone since.
      {
        id: 'd',
        flashCardId: 99,
        outcome: 'GotIt',
        practicedAt: '2026-10-19T10:03:00Z',
      },
    ]

    const result = withPendingAnswers(
      { ...pack, cards: [scoredCat, { ...dog, score: 50 }, house] },
      queue,
    )

    expect(result.cards).toEqual([
      { ...cat, score: 95, lastPracticedAt: '2026-10-19T10:01:00Z' },
      { ...dog, score: 0, lastPracticedAt: '2026-10-19T10:02:00Z' },
      house,
    ])
    expect(result.decks).toBe(pack.decks)
  })

  it.each([
    ['every card', {}, [cat, dog, house]],
    ["a deck's cards, in the deck's order", { deckId: 7 }, [house, cat]],
    ["a tag's cards", { tagId: pets.id }, [cat, house]],
    ['no cards for a deck that has gone', { deckId: 8 }, []],
    ['no cards for a tag no card has', { tagId: 5 }, []],
  ])('selects %s', (_, selection, expected) => {
    expect(selectCards(pack, selection)).toEqual(expected)
  })

  it('has the decks and tags to pick from on the device', () => {
    expect(storedChoices(subject)).toBeNull()

    writeStoredPack(subject, { ...pack, tags: [pets, tag(5, 'Travel')] })

    expect(storedChoices(subject)).toEqual({
      decks: pack.decks,
      tags: [pets, tag(5, 'Travel')],
    })
  })

  it('counts the answers waiting to be saved', () => {
    answer()
    answer(dog.id)

    expect(pendingCount(subject)).toBe(2)
  })
})
