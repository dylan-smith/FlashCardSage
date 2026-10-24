import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { defaultPreferences } from '../../api/preferences'
import { trackEvent, trackException } from '../../telemetry'
import { emptyResponse, jsonResponse, mockApi } from '../support/mockApi'
import type { Call } from '../support/mockApi'
import { renderAt, renderLoaded, signInForEachTest } from '../support/render'

signInForEachTest()

// The user's counts, with this many cards and practice answers.
function counts(cards: number, practiced: number) {
  return { cards, decks: 0, tags: 0, practiced }
}

function heading() {
  return screen.queryByRole('heading', { level: 2, name: 'Getting started' })
}

// The steps' ticks, which say whether each is done.
function ticks(name: 'Done' | 'To do') {
  return screen.queryAllByRole('img', { name })
}

describe('getting started guide', () => {
  it('shows a new user how to get going, with nothing done yet', async () => {
    await renderLoaded('/')

    expect(heading()).toBeInTheDocument()
    expect(
      screen.getByText("Welcome, Tester! Here's how to get going."),
    ).toBeInTheDocument()
    expect(ticks('To do')).toHaveLength(3)
    expect(ticks('Done')).toHaveLength(0)
    expect(
      screen.getByRole('link', { name: 'Pick a built-in deck' }),
    ).toHaveAttribute('href', '/import')
    expect(screen.getByRole('link', { name: 'Quiz yourself' })).toHaveAttribute(
      'href',
      '/practice',
    )
    expect(
      screen.getByRole('link', { name: 'Check your progress' }),
    ).toHaveAttribute('href', '/scores')
    // The cards page's tests count its list items, so the guide mustn't be a list.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('ticks off getting cards once the user has one', async () => {
    await renderLoaded('/', { 'GET /counts': counts(2, 0) })

    expect(await screen.findAllByRole('img', { name: 'Done' })).toHaveLength(1)
    expect(ticks('To do')).toHaveLength(2)
    expect(
      screen.getByText("Welcome, Tester! Here's how to get going."),
    ).toBeInTheDocument()
  })

  it("ticks off practicing too, and says the user's all set", async () => {
    await renderLoaded('/', { 'GET /counts': counts(2, 1) })

    expect(
      await screen.findByText(
        "You're all set, Tester! Here's where to go from here.",
      ),
    ).toBeInTheDocument()
    expect(ticks('Done')).toHaveLength(2)
    expect(ticks('To do')).toHaveLength(1)
  })

  it('leads to the built-in decks', async () => {
    const user = userEvent.setup()
    await renderLoaded('/')

    await user.click(screen.getByRole('link', { name: 'Pick a built-in deck' }))

    expect(
      await screen.findByRole('tab', { name: 'Built-in decks' }),
    ).toBeInTheDocument()
  })

  it('leads to practice', async () => {
    const user = userEvent.setup()
    await renderLoaded('/')

    await user.click(screen.getByRole('link', { name: 'Quiz yourself' }))

    expect(
      await screen.findByText('There are no flash cards to practice yet.'),
    ).toBeInTheDocument()
  })

  it('can be hidden, which is kept as a preference the preferences page turns back on', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({
      'PUT /preferences': (call: Call) => jsonResponse(call.body),
    })
    renderAt('/')
    await screen.findByRole('heading', { level: 2, name: 'Getting started' })

    await user.click(screen.getByRole('button', { name: 'Hide guide' }))

    expect(heading()).not.toBeInTheDocument()
    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith('GettingStartedHidden')
    })
    expect(
      calls.filter('PUT', '/preferences').map((call) => call.body),
    ).toEqual([{ ...defaultPreferences, showGettingStarted: false }])

    await user.click(screen.getByRole('link', { name: 'Preferences' }))
    const option = await screen.findByRole('switch', {
      name: 'Show the getting started guide',
    })
    expect(option).not.toBeChecked()
    await user.click(option)
    await user.click(screen.getByRole('link', { name: 'Manage cards' }))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Getting started' }),
    ).toBeInTheDocument()
    expect(calls.filter('PUT', '/preferences')).toHaveLength(2)
  })

  it("stays, and says why, when hiding it isn't saved", async () => {
    const user = userEvent.setup()
    mockApi({ 'PUT /preferences': emptyResponse(500) })
    renderAt('/')
    await screen.findByRole('heading', { level: 2, name: 'Getting started' })

    await user.click(screen.getByRole('button', { name: 'Hide guide' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to save preferences.',
    )
    expect(heading()).toBeInTheDocument()
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'savePreferences',
    })
  })

  it("isn't shown once the user has turned it off", async () => {
    await renderLoaded('/', {
      'GET /preferences': { ...defaultPreferences, showGettingStarted: false },
    })

    expect(
      screen.getByRole('heading', { level: 2, name: 'Add flash card' }),
    ).toBeInTheDocument()
    expect(heading()).not.toBeInTheDocument()
  })

  it("isn't shown until the preferences have loaded", async () => {
    await renderLoaded('/', {
      // Never answers.
      'GET /preferences': () => new Promise<Response>(() => {}),
    })

    expect(screen.getByText('No flash cards yet.')).toBeInTheDocument()
    expect(heading()).not.toBeInTheDocument()
  })
})
