import { apiBaseUrl } from '../config'
import { ResponseError, apiFetch, deleteGone, getJson } from './client'

// Who an app says it is. clientHost is the host of the app's metadata document's URL, which vouches for it (such as
// "claude.ai"), or null for an app that registered itself, whose clientName is only what it called itself, as
// clientNameIsSelfAsserted says. An app that registered itself may have given no name at all.
type OAuthClient = {
  clientName: string | null
  clientHost: string | null
  clientNameIsSelfAsserted: boolean
  scopes: string[]
}

// An app's sign-in waiting for the user to approve or deny it on the consent page. redirectHost is where the user is
// sent back to: a host, or the app's own scheme (such as "cursor") when it has none.
export type AuthorizationRequest = OAuthClient & {
  id: string
  redirectHost: string
  expiresAt: string
}

// An app the user has connected, which can read and change their cards until they disconnect it. lastUsedAt is null
// until it first uses its access.
export type Connection = OAuthClient & {
  id: number
  createdAt: string
  lastUsedAt: string | null
}

// What to call the app: the host that vouches for it, or the name it gave itself, which anyone could have picked.
export function appName(client: OAuthClient) {
  if (client.clientHost !== null) {
    return { name: client.clientHost, selfAsserted: false }
  }
  return client.clientName === null
    ? { name: 'An app with no name', selfAsserted: false }
    : { name: client.clientName, selfAsserted: true }
}

const authorizationsUrl = `${apiBaseUrl}/api/oauth/authorizations`
const connectionsUrl = `${apiBaseUrl}/api/oauth/connections`

// The sign-in, or null when it's unknown, has expired or has already been answered.
export async function getAuthorizationRequest(
  id: string,
  signal?: AbortSignal,
): Promise<AuthorizationRequest | null> {
  const response = await apiFetch(
    `${authorizationsUrl}/${encodeURIComponent(id)}`,
    { signal },
  )
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new ResponseError(response.status, 'Unable to load the sign-in.')
  }
  return (await response.json()) as AuthorizationRequest
}

// Answers the sign-in, and returns where to send the browser back to the app, or null when the sign-in has expired or
// was already answered.
async function answer(id: string, action: 'approve' | 'deny') {
  const response = await apiFetch(
    `${authorizationsUrl}/${encodeURIComponent(id)}/${action}`,
    { method: 'POST' },
  )
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new ResponseError(response.status, 'Unable to answer the sign-in.')
  }
  return ((await response.json()) as { redirectUrl: string }).redirectUrl
}

export function approveAuthorization(id: string) {
  return answer(id, 'approve')
}

export function denyAuthorization(id: string) {
  return answer(id, 'deny')
}

// The apps the user has connected, newest first.
export function getConnections(signal?: AbortSignal) {
  return getJson<Connection[]>(
    connectionsUrl,
    'Unable to load connected apps.',
    {
      signal,
    },
  )
}

// Takes the app's access away, so it has to ask the user again.
export function disconnectApp(id: number) {
  return deleteGone(`${connectionsUrl}/${id}`, 'Unable to disconnect the app.')
}
