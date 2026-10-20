import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AuthorizationRequest } from '../../api/oauth'
import { setSession } from '../../auth/session'
import { navigateAway } from '../../lib/navigateAway'
import { trackEvent, trackException } from '../../telemetry'
import { api } from '../support/factories'
import { emptyResponse, mockApi } from '../support/mockApi'
import type { Routes } from '../support/mockApi'
import { renderAt, signInForEachTest, waitForLoaded } from '../support/render'

// jsdom can't leave the page, so the tests check where the page sent the browser instead.
vi.mock('../../lib/navigateAway', () => ({ navigateAway: vi.fn() }))

signInForEachTest()

describe('the consent page', () => {
  const requestId = '6f1c2a54-0d1b-4f5e-9a63-2b7c8d9e0f11'
  const path = `/authorize?request=${requestId}`
  const claude: AuthorizationRequest = {
    id: requestId,
    clientName: 'Claude',
    clientHost: 'claude.ai',
    clientNameIsSelfAsserted: false,
    redirectHost: 'claude.ai',
    scopes: ['flashcards'],
    expiresAt: '2026-10-20T12:15:00Z',
  }
  const cursor: AuthorizationRequest = {
    ...claude,
    clientName: 'Cursor',
    clientHost: null,
    clientNameIsSelfAsserted: true,
    redirectHost: 'cursor',
  }
  const approvedUrl =
    'https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz'
  const deniedUrl =
    'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=xyz'

  // Answers loading the request, and approving and denying it, and anything else from routes.
  function mockConsent(
    request: AuthorizationRequest | null,
    routes: Routes = {},
  ) {
    return mockApi({
      [`GET /oauth/authorizations/${requestId}`]: request ?? emptyResponse(404),
      [`POST /oauth/authorizations/${requestId}/approve`]: {
        redirectUrl: approvedUrl,
      },
      [`POST /oauth/authorizations/${requestId}/deny`]: {
        redirectUrl: deniedUrl,
      },
      ...routes,
    }).calls
  }

  async function showConsent() {
    renderAt(path)
    await waitForLoaded()
  }

  function consentText() {
    return screen.getByText(/wants to read and change your flash cards/)
  }

  it('names an app its metadata document vouches for by its host, and stands alone', async () => {
    mockConsent(claude)
    await showConsent()

    expect(
      screen.getByRole('heading', { level: 2, name: 'Connect an app' }),
    ).toBeInTheDocument()
    expect(consentText()).toHaveTextContent(
      'claude.ai wants to read and change your flash cards.',
    )
    expect(screen.queryByText(/a name the app gave itself/)).toBeNull()
    expect(screen.getByText(/you'll go back to/)).toHaveTextContent(
      "Either way, you'll go back to claude.ai.",
    )
    expect(screen.getByText(/Signed in as/)).toHaveTextContent(
      'Signed in as Tester.',
    )
    // Nothing leads the user off to another page.
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Preferences' })).toBeNull()
  })

  it('says an app that registered itself only named itself', async () => {
    mockConsent(cursor)
    await showConsent()

    expect(consentText()).toHaveTextContent(
      'Cursor (a name the app gave itself) wants to read and change your flash cards.',
    )
    expect(
      screen.getByText(/Anyone can give an app this name/),
    ).toBeInTheDocument()
    expect(screen.getByText(/you'll go back to/)).toHaveTextContent(
      "Either way, you'll go back to cursor.",
    )
  })

  it('names an app that registered itself with no name', async () => {
    mockConsent({ ...cursor, clientName: null })
    await showConsent()

    expect(consentText()).toHaveTextContent(
      'An app with no name wants to read and change your flash cards.',
    )
  })

  it('approves, and sends the browser back to the app', async () => {
    const user = userEvent.setup()
    const calls = mockConsent(claude)
    await showConsent()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText(/^Connected\./)).toBeInTheDocument()
    expect(navigateAway).toHaveBeenCalledWith(approvedUrl)
    expect(calls.find('POST')?.url).toBe(
      api(`/oauth/authorizations/${requestId}/approve`),
    )
    expect(trackEvent).toHaveBeenCalledWith('AppApproved')
  })

  it('denies, and sends the browser back to the app', async () => {
    const user = userEvent.setup()
    const calls = mockConsent(claude)
    await showConsent()

    await user.click(screen.getByRole('button', { name: 'Deny' }))

    expect(await screen.findByText(/^Not connected\./)).toBeInTheDocument()
    expect(navigateAway).toHaveBeenCalledWith(deniedUrl)
    expect(calls.find('POST')?.url).toBe(
      api(`/oauth/authorizations/${requestId}/deny`),
    )
    expect(trackEvent).toHaveBeenCalledWith('AppDenied')
  })

  it("won't send the browser to a script", async () => {
    const user = userEvent.setup()
    mockConsent(claude, {
      [`POST /oauth/authorizations/${requestId}/approve`]: {
        redirectUrl: 'javascript:alert(1)',
      },
    })
    await showConsent()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to answer the request to connect an app.',
    )
    expect(navigateAway).not.toHaveBeenCalled()
    expect(trackException).toHaveBeenCalled()
  })

  it('says when the request has expired or was already answered', async () => {
    mockConsent(null)
    await showConsent()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This request to connect an app has expired or has already been answered.',
    )
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('says when the request expires before the user answers', async () => {
    const user = userEvent.setup()
    mockConsent(claude, {
      [`POST /oauth/authorizations/${requestId}/approve`]: emptyResponse(404),
    })
    await showConsent()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'has expired or has already been answered',
    )
    expect(navigateAway).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid_client', "FlashCardSage doesn't know this app"],
    ['invalid_redirect_uri', "somewhere it hasn't registered"],
    ['server_error', "This link to connect an app doesn't work."],
  ])(
    'explains the error the API sent the user here with: %s',
    (error, message) => {
      const calls = mockConsent(claude)
      renderAt(`/authorize?error=${error}`)

      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(calls.some('GET', `/oauth/authorizations/${requestId}`)).toBe(
        false,
      )
    },
  )

  it('asks a signed-out user to sign in first, then shows the request', async () => {
    const user = userEvent.setup()
    act(() => setSession(null))
    mockConsent(claude)
    renderAt(path)

    await user.click(
      screen.getByRole('button', { name: 'Sign in as test user' }),
    )

    await waitFor(() => {
      expect(consentText()).toHaveTextContent('claude.ai wants')
    })
    expect(screen.getByText(/Signed in as/)).toHaveTextContent(
      'Signed in as Preview User.',
    )
  })

  it('lets the user sign out to sign in as someone else', async () => {
    const user = userEvent.setup()
    mockConsent(claude)
    await showConsent()

    await user.click(screen.getByRole('button', { name: 'Not you? Sign out' }))

    expect(
      screen.getByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
  })
})
