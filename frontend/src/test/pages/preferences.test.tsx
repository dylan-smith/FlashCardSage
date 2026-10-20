import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { defaultPreferences } from '../../api/preferences'
import { trackEvent, trackException } from '../../telemetry'
import { api, cat } from '../support/factories'
import { emptyResponse, jsonResponse, mockApi } from '../support/mockApi'
import type { Call, Routes } from '../support/mockApi'
import { renderAt, signInForEachTest } from '../support/render'

signInForEachTest()

describe('preferences', () => {
  const pictured = { ...cat, imageUrl: 'http://images.test/1.png' }

  // Lists the cat, and answers saving the preferences with status, as the API would, and anything else from routes.
  function mockPreferences(status = 200, routes: Routes = {}) {
    return mockApi({
      'GET /flashcards': [pictured],
      'PUT /preferences': (call: Call) =>
        status === 200 ? jsonResponse(call.body) : emptyResponse(status),
      ...routes,
    }).calls
  }

  function preferenceSwitch(name: string) {
    return screen.getByRole('switch', { name })
  }

  it('links to the page from the top, which shows the preferences the user has', async () => {
    const user = userEvent.setup()
    mockPreferences(200, {
      'GET /preferences': { ...defaultPreferences, showSuggestions: false },
    })
    renderAt('/')
    await screen.findByText('el gato')

    // A cog icon, named for screen readers, rather than text.
    const link = screen.getByRole('link', { name: 'Preferences' })
    expect(link).not.toHaveTextContent(/\S/)
    await user.click(link)

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Preferences' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Preferences' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(preferenceSwitch('Show pictures')).toBeChecked()
    expect(preferenceSwitch('Suggest cards')).not.toBeChecked()
    expect(preferenceSwitch('Translate automatically')).toBeChecked()
    expect(
      preferenceSwitch('Translate automatically'),
    ).toHaveAccessibleDescription(/you type both sides/)
  })

  it("saves a change as soon as it's made, and the app follows it", async () => {
    const user = userEvent.setup()
    const calls = mockPreferences()
    renderAt('/preferences')

    await user.click(
      await screen.findByRole('switch', { name: 'Show pictures' }),
    )

    expect(preferenceSwitch('Show pictures')).not.toBeChecked()
    expect(preferenceSwitch('Show pictures')).toHaveFocus()
    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith('PreferencesUpdated')
    })
    expect(
      calls
        .filter('PUT')
        .map((call) => [call.init?.method, call.url, call.init?.body]),
    ).toEqual([
      [
        'PUT',
        api('/preferences'),
        JSON.stringify({
          showPictures: false,
          showSuggestions: true,
          autoTranslate: true,
        }),
      ],
    ])

    await user.click(screen.getByRole('link', { name: 'Manage cards' }))

    expect(await screen.findByText('el gato')).toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: /picture/i }),
    ).not.toBeInTheDocument()
  })

  it("turns a change back and says why when it isn't saved", async () => {
    const user = userEvent.setup()
    mockPreferences(500)
    renderAt('/preferences')

    await user.click(
      await screen.findByRole('switch', { name: 'Suggest cards' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to save preferences.',
    )
    expect(preferenceSwitch('Suggest cards')).toBeChecked()
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'savePreferences',
    })
  })

  it("works as it does for a new user when the preferences can't be loaded", async () => {
    mockPreferences(200, { 'GET /preferences': emptyResponse(500) })
    renderAt('/')

    expect(
      await screen.findByRole('img', { name: 'Picture for "el gato"' }),
    ).toBeInTheDocument()
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'loadPreferences',
    })
  })

  // Kept for the signed-in user (see sessionSubject), so they apply offline.
  const storedKey = 'flashcardsage.preferences:test:tester'

  it("keeps the preferences on the device once they're loaded", async () => {
    const preferences = { ...defaultPreferences, showPictures: false }
    mockPreferences(200, { 'GET /preferences': preferences })
    renderAt('/')

    await waitFor(() => {
      expect(localStorage.getItem(storedKey)).toBe(JSON.stringify(preferences))
    })
  })

  it("uses the preferences kept on the device when they can't be loaded", async () => {
    localStorage.setItem(
      storedKey,
      JSON.stringify({ ...defaultPreferences, showPictures: false }),
    )
    mockPreferences(200, { 'GET /preferences': emptyResponse(500) })
    renderAt('/')

    await screen.findByText('el gato')
    await waitFor(() => {
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'loadPreferences',
      })
    })
    expect(
      screen.queryByRole('img', { name: 'Picture for "el gato"' }),
    ).not.toBeInTheDocument()
  })
})
