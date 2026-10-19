import { act, render, screen, waitFor, within } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, onTestFinished, vi } from 'vitest'
import App from '../../App'
import { setSession } from '../../auth/session'
import { mockApi } from './mockApi'
import type { Routes } from './mockApi'

export type User = ReturnType<typeof userEvent.setup>

// Signs in as Tester before each test, since the app only shows the sign-in page otherwise, and signs out and puts
// the mocks back after it. auth.test.tsx covers signing in and out.
export function signInForEachTest() {
  beforeEach(() => {
    setSession({ token: 'test:Tester', name: 'Tester', provider: 'test' })
  })

  afterEach(() => {
    // Signing out re-renders the app if a test left it mounted.
    act(() => setSession(null))
    // What the app kept for the user, such as their preferences, isn't cleared at sign-out.
    localStorage.clear()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })
}

export function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

export async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
  })
}

// Renders the app at path with the API answering from routes (see mockApi), once it has loaded.
export async function renderLoaded(path: string, routes: Routes = {}) {
  const mock = mockApi(routes)
  renderAt(path)
  await waitForLoaded()
  return mock
}

// Clicks a Delete button, then Delete in the dialog that asks whether the user means it.
export async function clickDelete(user: User, button: string, dialog: string) {
  await user.click(screen.getByRole('button', { name: button }))
  await user.click(
    within(await screen.findByRole('dialog', { name: dialog })).getByRole(
      'button',
      { name: 'Delete' },
    ),
  )
}

// A screen that matches the media queries matches says yes to, until the test ends. jsdom has no matchMedia of its
// own, so it's taken as a phone everywhere else.
export function stubMatchMedia(matches: (query: string) => boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
}
