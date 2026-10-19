import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { PracticePack } from '../api/practice'
import { cachePictures, picturesCacheName } from '../practice/pictures'
import { trackException } from '../telemetry'
import { packCard } from './support/factories'

const pictures = 'https://pictures.example'

// A cache like the browser's, keyed by URL, which keeps what's put in it.
function fakeCaches() {
  const entries = new Map<string, Response>()
  const cache = {
    keys: vi.fn(() =>
      Promise.resolve([...entries.keys()].map((url) => new Request(url))),
    ),
    delete: vi.fn((request: Request) =>
      Promise.resolve(entries.delete(request.url)),
    ),
    put: vi.fn((url: string, response: Response) => {
      entries.set(url, response)
      return Promise.resolve()
    }),
  }
  const open = vi.fn(() => Promise.resolve(cache))
  vi.stubGlobal('caches', { open })
  return { entries, cache, open }
}

function packWith(...imageUrls: (string | null)[]): PracticePack {
  return {
    cards: imageUrls.map((imageUrl, index) =>
      packCard(index + 1, `palabra ${index}`, `word ${index}`, { imageUrl }),
    ),
    decks: [],
    tags: [],
  }
}

// The pictures fetched, and how.
function fetched(fetch: FetchMock) {
  return fetch.mock.calls.map(([url, init]) => [url, init] as const)
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>
type FetchMock = Mock<Fetch>

let fetch: FetchMock

beforeEach(() => {
  fetch = vi.fn<Fetch>((url) =>
    Promise.resolve(new Response(`picture at ${url}`, { status: 200 })),
  )
  vi.stubGlobal('fetch', fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("keeping the cards' pictures on the device", () => {
  it('fetches the pictures it does not have, with CORS so they can be checked', async () => {
    const { entries, open } = fakeCaches()

    await cachePictures(packWith(`${pictures}/cat.png`, null))

    expect(open).toHaveBeenCalledWith(picturesCacheName)
    expect(fetched(fetch)).toEqual([[`${pictures}/cat.png`, { mode: 'cors' }]])
    expect([...entries.keys()]).toEqual([`${pictures}/cat.png`])
  })

  it('skips the pictures it already has', async () => {
    const { entries } = fakeCaches()
    entries.set(`${pictures}/cat.png`, new Response('cat'))

    await cachePictures(packWith(`${pictures}/cat.png`, `${pictures}/dog.png`))

    expect(fetched(fetch)).toEqual([[`${pictures}/dog.png`, { mode: 'cors' }]])
  })

  it('drops the pictures no card has any more', async () => {
    const { entries } = fakeCaches()
    entries.set(`${pictures}/old.png`, new Response('old'))
    entries.set(`${pictures}/cat.png`, new Response('cat'))

    await cachePictures(packWith(`${pictures}/cat.png`))

    expect([...entries.keys()]).toEqual([`${pictures}/cat.png`])
  })

  it('fetches four at a time', async () => {
    fakeCaches()
    let inFlight = 0
    let most = 0
    fetch.mockImplementation(async () => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 0))
      inFlight--
      return new Response('picture')
    })

    await cachePictures(
      packWith(...Array.from({ length: 10 }, (_, i) => `${pictures}/${i}.png`)),
    )

    expect(fetch).toHaveBeenCalledTimes(10)
    expect(most).toBe(4)
  })

  it("never keeps a response that isn't ok, and goes on past one that fails", async () => {
    const { entries } = fakeCaches()
    fetch.mockImplementation((url: string) => {
      if (url.endsWith('missing.png')) {
        return Promise.resolve(new Response(null, { status: 404 }))
      }
      if (url.endsWith('broken.png')) {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      return Promise.resolve(new Response('picture'))
    })

    await cachePictures(
      packWith(
        `${pictures}/missing.png`,
        `${pictures}/broken.png`,
        `${pictures}/cat.png`,
      ),
    )

    expect([...entries.keys()]).toEqual([`${pictures}/cat.png`])
    expect(trackException).not.toHaveBeenCalled()
  })

  it('does it once at a time, and then for the newest pack asked for meanwhile', async () => {
    const { open } = fakeCaches()

    const first = cachePictures(packWith(`${pictures}/cat.png`))
    const second = cachePictures(packWith(`${pictures}/dog.png`))
    const third = cachePictures(packWith(`${pictures}/house.png`))
    await Promise.all([first, second, third])

    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(open).toHaveBeenCalledTimes(2)
    expect(fetched(fetch).map(([url]) => url)).toEqual([
      `${pictures}/cat.png`,
      `${pictures}/house.png`,
    ])
  })

  it('reports a cache that cannot be opened', async () => {
    const error = new Error('No cache')
    vi.stubGlobal('caches', { open: () => Promise.reject(error) })

    await cachePictures(packWith(`${pictures}/cat.png`))

    expect(trackException).toHaveBeenCalledWith(error, {
      operation: 'cachePictures',
    })
  })

  it("does nothing where there's no cache storage", async () => {
    await cachePictures(packWith(`${pictures}/cat.png`))

    expect(fetch).not.toHaveBeenCalled()
  })
})
