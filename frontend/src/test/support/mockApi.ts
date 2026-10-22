import { vi } from 'vitest'
import { defaultPreferences } from '../../api/preferences'
import { api } from './factories'

// A request the app sent the API. path is the part after /api, with its query, and pathname the same without it.
// body is what was sent, parsed when it's JSON.
export type Call = {
  method: string
  url: string
  path: string
  pathname: string
  query: URLSearchParams
  // The route's :name segments, such as id for 'PUT /flashcards/:id'.
  params: Record<string, string>
  body: unknown
  init?: RequestInit
}

// How a route answers: a function of the request, a Response (sent as a copy each time), or anything else, which is
// sent as JSON.
export type Answer = unknown

// Answers keyed by method and path, such as 'GET /flashcards', 'GET /decks/7', 'PUT /flashcards/:id' or
// 'GET /card-suggestions?tag=5'. A key with a query only answers that query, and one without answers any.
export type Routes = Record<string, Answer>

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function emptyResponse(status: number): Response {
  return new Response(null, { status })
}

// fetch rejects like this when the API can't be reached at all.
export function unreachable(): Promise<Response> {
  throw new TypeError('Failed to fetch')
}

// What the pages load, answered as for a new user: no cards, tags, decks, built-in decks or connected apps, the default
// preferences, not an admin, and nothing from the services that aren't there locally (suggestions and translation).
const defaultRoutes: Routes = {
  'GET /flashcards': [],
  'GET /tags': [],
  'GET /decks': [],
  'GET /system-decks': [],
  'GET /counts': { cards: 0, decks: 0, tags: 0 },
  'GET /preferences': defaultPreferences,
  'GET /me': { displayName: 'Tester', email: null, isAdmin: false },
  'GET /oauth/connections': [],
  'GET /flashcards/practice/pack': { cards: [], decks: [], tags: [] },
  'GET /card-suggestions': emptyResponse(503),
  'POST /tag-suggestions': emptyResponse(503),
  'GET /tag-suggestions/new': emptyResponse(503),
  'POST /translations': emptyResponse(503),
}

// What the app asks for in the background, which mockApi keeps apart from the calls a test checks.
const backgroundRequests = new Set([
  'GET /counts',
  'GET /preferences',
  'GET /me',
  // Loaded at sign-in too, and after answers are saved (see practice/sync).
  'GET /flashcards/practice/pack',
  'GET /card-suggestions',
  'POST /tag-suggestions',
  'GET /tag-suggestions/new',
])

function matches(call: Call, method?: string, path?: string) {
  return (
    (method === undefined || call.method === method) &&
    (path === undefined ||
      (path.includes('?') ? call.path === path : call.pathname === path))
  )
}

// The requests the app sent, in order. A path with a query only matches that query, and one without matches any.
export class CallLog {
  readonly all: Call[] = []

  find(method?: string, path?: string) {
    return this.all.find((call) => matches(call, method, path))
  }

  filter(method?: string, path?: string) {
    return this.all.filter((call) => matches(call, method, path))
  }

  some(method?: string, path?: string) {
    return this.all.some((call) => matches(call, method, path))
  }
}

// The route for a path with :name segments, and the segments' values.
function matchPattern(routes: Routes, method: string, pathname: string) {
  const segments = pathname.split('/')
  for (const key of Object.keys(routes)) {
    const [keyMethod, keyPath] = key.split(' ')
    const keySegments = keyPath.split('/')
    if (
      keyMethod !== method ||
      !keyPath.includes(':') ||
      keySegments.length !== segments.length
    ) {
      continue
    }
    const params: Record<string, string> = {}
    if (
      keySegments.every((segment, index) => {
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = segments[index]
          return true
        }
        return segment === segments[index]
      })
    ) {
      return { key, params }
    }
  }
  return undefined
}

function parseBody(body: RequestInit['body']) {
  if (typeof body !== 'string') {
    return body
  }
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

// Answers the app's fetches from routes, over the defaults above, and throws for anything else. calls has what the
// app sent apart from the background requests, which are in background. routes can be changed while a test runs.
export function mockApi(routes: Routes = {}) {
  const table: Routes = { ...defaultRoutes, ...routes }
  const calls = new CallLog()
  const background = new CallLog()
  const prefix = api('')
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      const method = init?.method ?? 'GET'
      if (!url.startsWith(prefix)) {
        throw new Error(`Unexpected ${method} ${url}`)
      }
      const path = url.slice(prefix.length)
      const [pathname, search = ''] = path.split('?')
      const pattern = matchPattern(table, method, pathname)
      const key = [`${method} ${path}`, `${method} ${pathname}`].find(
        (candidate) => candidate in table,
      )
      const call: Call = {
        method,
        url,
        path,
        pathname,
        query: new URLSearchParams(search),
        params: key === undefined ? (pattern?.params ?? {}) : {},
        body: parseBody(init?.body),
        init,
      }
      ;(backgroundRequests.has(`${method} ${pathname}`)
        ? background
        : calls
      ).all.push(call)
      const routeKey = key ?? pattern?.key
      if (routeKey === undefined) {
        throw new Error(`Unexpected ${method} ${path}`)
      }
      const answer = table[routeKey]
      if (typeof answer === 'function') {
        return (await (answer as (call: Call) => unknown)(call)) as Response
      }
      return answer instanceof Response ? answer.clone() : jsonResponse(answer)
    },
  )
  return { calls, background, routes: table }
}
