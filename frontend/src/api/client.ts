import { getSession, setSession } from '../auth/session'

// fetch with the signed-in user's token. A 401 means the token has expired or isn't valid any more, so the user is
// signed out and sees the sign-in page, which brings them back to the same page once they sign in again.
export async function apiFetch(url: string, init: RequestInit = {}) {
  const session = getSession()
  const headers = new Headers(init.headers)
  if (session !== null) {
    headers.set('Authorization', `Bearer ${session.token}`)
  }

  const response = await fetch(url, { ...init, headers })

  if (response.status === 401 && session !== null && getSession() === session) {
    setSession(null)
  }
  return response
}

// The body of a 400 from the API, with the messages for each invalid field.
type ValidationErrorResponse = {
  errors?: Record<string, string[]>
}

// The body of another error from the API, such as a 409 for a card the user already has.
type ProblemResponse = {
  detail?: string
}

const duplicateMessage =
  'You already have a flash card with this Spanish or English.'

// Thrown for a response the caller should show to the user as is, such as a 400 for a blank translation.
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// Thrown for any other response that isn't ok, with the caller's message for it. It keeps the status so a caller can
// expect one, such as a 503 for a service that isn't available, and is reported like any other Error.
export class ResponseError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// fetch rejects with a TypeError when the API can't be reached at all, including while a deployment has
// it paused (see the deploy-backend job in ci.yml), so tell the user to retry rather than show a generic error.
export const unreachableMessage =
  "Can't reach FlashCardSage right now. It may be updating, so try again in a minute."

export function describeFetchError(error: unknown, fallback: string) {
  if (error instanceof TypeError) {
    return unreachableMessage
  }
  return error instanceof ApiError ? error.message : fallback
}

// Throws for a save that didn't go through. A 400 says what's wrong with what was sent, so that's passed on.
export async function throwIfNotSaved(response: Response, fallback: string) {
  if (response.status === 400) {
    const error = (await response.json()) as ValidationErrorResponse
    const message = Object.values(error.errors ?? {}).flat()[0]
    throw new ApiError(400, message ?? fallback)
  }
  // A 409 means the user already has this card.
  if (response.status === 409) {
    const problem = (await response.json()) as ProblemResponse
    throw new ApiError(409, problem.detail ?? duplicateMessage)
  }
  if (!response.ok) {
    throw new ResponseError(response.status, fallback)
  }
}

// A request that sends the body as JSON.
export function jsonRequest(
  method: string,
  body: unknown,
  signal?: AbortSignal,
): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }
}

// The response, or throws a ResponseError with the fallback message when it isn't ok.
export async function fetchOk(
  url: string,
  fallback: string,
  init?: RequestInit,
) {
  const response = await apiFetch(url, init)
  if (!response.ok) {
    throw new ResponseError(response.status, fallback)
  }
  return response
}

// The response's JSON, or throws a ResponseError with the fallback message when it isn't ok.
export async function getJson<T>(
  url: string,
  fallback: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchOk(url, fallback, init)
  return (await response.json()) as T
}

// Saves the body, sent as JSON (or nothing when it's undefined), and returns what the API sends back. Throws as
// throwIfNotSaved does when it isn't saved.
export async function sendJson<T>(
  method: string,
  url: string,
  body: unknown,
  fallback: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await apiFetch(
    url,
    body === undefined ? { method, signal } : jsonRequest(method, body, signal),
  )
  await throwIfNotSaved(response, fallback)
  return (await response.json()) as T
}

// Deletes what's at the URL. A 404 means it's already gone, which is what the caller wanted.
export async function deleteGone(url: string, fallback: string) {
  const response = await apiFetch(url, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) {
    throw new ResponseError(response.status, fallback)
  }
}

// What the request returns, or null when the service behind it isn't available (a 503, e.g. locally, where there's no
// Foundry endpoint and key).
export async function optional<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request
  } catch (error) {
    if (error instanceof ResponseError && error.status === 503) {
      return null
    }
    throw error
  }
}

// The URL with the parameters that have a value as its query string.
export function withQuery(
  url: string,
  params: Record<string, string | number | undefined>,
) {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(name, String(value))
    }
  }
  const text = query.toString()
  return text ? `${url}?${text}` : url
}
