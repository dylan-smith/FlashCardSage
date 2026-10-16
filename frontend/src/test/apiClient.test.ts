import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  ResponseError,
  deleteGone,
  getJson,
  optional,
  sendJson,
  withQuery,
} from '../api/client'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('the API client', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('reads the JSON of a response that is ok', async () => {
    fetchMock.mockResolvedValue(jsonResponse([1, 2]))

    await expect(
      getJson<number[]>('/things', 'Unable to load.'),
    ).resolves.toEqual([1, 2])
  })

  it('throws the fallback, with the status, for a response that is not ok', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))

    const error: unknown = await getJson('/things', 'Unable to load.').catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ResponseError)
    expect(error).not.toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 500, message: 'Unable to load.' })
  })

  it('sends a body as JSON and passes on what is wrong with it', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ errors: { Name: ['Name is too long.'] } }, 400),
    )

    await expect(
      sendJson('POST', '/things', { name: 'gato' }, 'Unable to save.'),
    ).rejects.toEqual(new ApiError(400, 'Name is too long.'))
    const init = fetchMock.mock.calls[0][1]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"name":"gato"}')
    expect(new Headers(init?.headers).get('Content-Type')).toBe(
      'application/json',
    )
  })

  it('sends no body when there is none', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }))

    await expect(
      sendJson('POST', '/things/1/import', undefined, 'Unable to add.'),
    ).resolves.toEqual({ id: 1 })
    const init = fetchMock.mock.calls[0][1]
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false)
  })

  it('treats a 404 as deleted', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))

    await expect(
      deleteGone('/things/1', 'Unable to delete.'),
    ).resolves.toBeUndefined()

    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))

    await expect(deleteGone('/things/1', 'Unable to delete.')).rejects.toThrow(
      'Unable to delete.',
    )
  })

  it('returns null for a service that is not available, and throws for other failures', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }))

    await expect(optional(getJson('/suggestions', 'Unable.'))).resolves.toBe(
      null,
    )

    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))

    await expect(optional(getJson('/suggestions', 'Unable.'))).rejects.toThrow(
      'Unable.',
    )
  })

  it('puts only the parameters with a value in the query string', () => {
    expect(withQuery('/things', {})).toBe('/things')
    expect(withQuery('/things', { tag: undefined })).toBe('/things')
    expect(
      withQuery('/things', { deckId: 3, tagId: undefined, q: 'a b' }),
    ).toBe('/things?deckId=3&q=a+b')
  })
})
