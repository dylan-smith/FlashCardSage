import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { getSession, setSession } from '../../auth/session'
import { storageKeys, userStorageKey } from '../../lib/storageKeys'
import { trackEvent } from '../../telemetry'
import { emptyResponse } from '../support/mockApi'
import type { Routes } from '../support/mockApi'
import { renderAt, renderLoaded, signInForEachTest } from '../support/render'

signInForEachTest()

describe('deleting the account', () => {
  const subject = 'test:tester'

  async function askToDelete(routes: Routes = {}) {
    const user = userEvent.setup()
    const { calls } = await renderLoaded('/preferences', {
      'GET /oauth/connections': [],
      ...routes,
    })
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete your account?',
    })
    return { user, calls, dialog }
  }

  function confirmButton(dialog: HTMLElement) {
    return within(dialog).getByRole('button', { name: 'Delete account' })
  }

  it('deletes the account once the user types DELETE, clears what was kept for them and signs them out', async () => {
    localStorage.setItem(
      userStorageKey(storageKeys.practiceQueue, subject),
      '[]',
    )
    const { user, calls, dialog } = await askToDelete({
      'DELETE /me': emptyResponse(204),
    })

    expect(confirmButton(dialog)).toBeDisabled()
    await user.type(
      within(dialog).getByLabelText('Type DELETE to confirm'),
      'DELETE',
    )
    await user.click(confirmButton(dialog))

    await waitFor(() => expect(getSession()).toBeNull())
    expect(calls.filter('DELETE', '/me')).toHaveLength(1)
    expect(trackEvent).toHaveBeenCalledWith('AccountDeleted')
    expect(
      localStorage.getItem(userStorageKey(storageKeys.practiceQueue, subject)),
    ).toBeNull()
    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument()
  })

  it('keeps the account when the user cancels', async () => {
    const { user, calls, dialog } = await askToDelete()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Delete your account?' }),
      ).not.toBeInTheDocument(),
    )
    expect(calls.some('DELETE', '/me')).toBe(false)
    expect(getSession()).not.toBeNull()
  })

  it("says so and keeps the user signed in when the account can't be deleted", async () => {
    const { user, dialog } = await askToDelete({
      'DELETE /me': emptyResponse(500),
    })

    await user.type(
      within(dialog).getByLabelText('Type DELETE to confirm'),
      'DELETE',
    )
    await user.click(confirmButton(dialog))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to delete your account.',
    )
    expect(getSession()).not.toBeNull()
  })
})

describe('privacy policy', () => {
  it('is linked from Preferences, and says how to delete an account', async () => {
    const user = userEvent.setup()
    await renderLoaded('/preferences', { 'GET /oauth/connections': [] })

    await user.click(screen.getByRole('link', { name: 'privacy policy' }))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Privacy policy' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'Deleting your account' }),
    ).toBeInTheDocument()
  })

  it('opens for a signed-out visitor, from the landing page, with a way back', async () => {
    const user = userEvent.setup()
    act(() => setSession(null))
    renderAt('/')

    await user.click(screen.getByRole('link', { name: 'Privacy policy' }))

    expect(
      screen.getByRole('heading', { level: 2, name: 'Privacy policy' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('link', { name: 'Back to FlashCardSage' }),
    )
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})
