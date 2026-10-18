import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionFromGoogleCredential } from '../auth/google'
import { getSession, setSession } from '../auth/session'
import { storageKeys } from '../lib/storageKeys'
import { card } from './support/factories'
import { emptyResponse, mockApi } from './support/mockApi'
import { renderAt, waitForLoaded } from './support/render'

function authorizationOf(call: unknown[]) {
  return new Headers((call[1] as RequestInit | undefined)?.headers).get(
    'Authorization',
  )
}

afterEach(() => {
  // Signing out re-renders the app if a test left it mounted.
  act(() => setSession(null))
  vi.restoreAllMocks()
})

describe('signing in', () => {
  it('shows the sign-in page and loads nothing while signed out', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    renderAt('/')

    expect(
      screen.getByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('signs in as a test user and sends their token with each request', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /flashcards': [card(1, 'buenos días', 'good morning')],
    })
    renderAt('/')

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), '  Alice  ')
    await user.click(
      screen.getByRole('button', { name: 'Sign in as test user' }),
    )

    expect(await screen.findByText('buenos días')).toBeInTheDocument()
    await waitForLoaded()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(authorizationOf(vi.mocked(fetch).mock.calls[0])).toBe(
      'Bearer test:Alice',
    )
    expect(
      JSON.parse(localStorage.getItem(storageKeys.session) ?? '{}'),
    ).toMatchObject({ token: 'test:Alice', name: 'Alice' })
  })

  it("can't sign in as a test user without a name", async () => {
    const user = userEvent.setup()
    renderAt('/')

    await user.clear(screen.getByLabelText('Name'))

    expect(
      screen.getByRole('button', { name: 'Sign in as test user' }),
    ).toBeDisabled()
  })
})

describe('signed in', () => {
  it('signs out', async () => {
    const user = userEvent.setup()
    mockApi()
    setSession({ token: 'test:Bob', name: 'Bob', provider: 'test' })
    renderAt('/')
    await screen.findByText('No flash cards yet.')

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(
      screen.getByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(localStorage.getItem(storageKeys.session)).toBeNull()
  })

  it('signs out when the API no longer accepts the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(emptyResponse(401))
    setSession({ token: 'expired', name: 'Carol', provider: 'google' })

    renderAt('/')

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(getSession()).toBeNull()
  })

  it('keeps a sign-in from an earlier visit', async () => {
    mockApi()
    setSession({ token: 'test:Dana', name: 'Dana', provider: 'test' })

    renderAt('/')

    expect(screen.getByText('Dana')).toBeInTheDocument()
    await waitForLoaded()
  })
})

describe('sessionFromGoogleCredential', () => {
  it("reads the user's name, email and picture from the ID token", () => {
    const payload = {
      sub: '123',
      name: 'Zoë Example',
      email: 'zoe@example.com',
      picture: 'https://example.com/zoe.png',
    }
    const encoded = btoa(
      String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const credential = `header.${encoded}.signature`

    expect(sessionFromGoogleCredential(credential)).toEqual({
      token: credential,
      name: 'Zoë Example',
      email: 'zoe@example.com',
      pictureUrl: 'https://example.com/zoe.png',
      provider: 'google',
    })
  })
})
