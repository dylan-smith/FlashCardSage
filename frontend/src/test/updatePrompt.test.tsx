import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  reloadPage,
  updateCheckIntervalMs,
  updateReady,
  watchForUpdates,
} from '../pwa/serviceWorker'
import UpdatePrompt from '../pwa/UpdatePrompt'

vi.mock('../pwa/serviceWorker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pwa/serviceWorker')>()),
  reloadPage: vi.fn(),
}))

const message = 'A new version of FlashCardSage is available.'

// jsdom has no service workers, so the page's is a stand-in that tells it when another takes over.
class FakeServiceWorkerContainer extends EventTarget {
  controller: object | null

  constructor(controller: object | null) {
    super()
    this.controller = controller
  }

  takeOver() {
    this.controller = {}
    this.dispatchEvent(new Event('controllerchange'))
  }
}

function fakeRegistration() {
  return {
    installing: null,
    update: vi.fn(() => Promise.resolve()),
  }
}

function watch(container: FakeServiceWorkerContainer) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: container,
  })
  const registration = fakeRegistration()
  watchForUpdates(registration as unknown as ServiceWorkerRegistration)
  return registration
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  updateReady.set(false)
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('update prompt', () => {
  it('shows nothing while the current version is the latest', () => {
    render(<UpdatePrompt />)

    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })

  it('offers to reload once a new version is ready', async () => {
    const user = userEvent.setup()
    render(<UpdatePrompt />)

    act(() => updateReady.set(true))

    expect(screen.getByText(message)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  it('can be dismissed until the next load', async () => {
    const user = userEvent.setup()
    render(<UpdatePrompt />)
    act(() => updateReady.set(true))

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByText(message)).not.toBeInTheDocument(),
    )
  })
})

describe('watching for a new version', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('is ready when a new service worker takes over the page', () => {
    const container = new FakeServiceWorkerContainer({})
    watch(container)

    container.takeOver()

    expect(updateReady.get()).toBe(true)
  })

  it("isn't ready when the first service worker takes over a page that had none", () => {
    const container = new FakeServiceWorkerContainer(null)
    watch(container)

    container.takeOver()
    expect(updateReady.get()).toBe(false)

    // The next one is a new version.
    container.takeOver()
    expect(updateReady.get()).toBe(true)
  })

  it('looks for a new version when the app comes back into view', () => {
    const registration = watch(new FakeServiceWorkerContainer({}))

    setVisibility('hidden')
    expect(registration.update).not.toHaveBeenCalled()

    setVisibility('visible')
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('looks for a new version now and then while it stays open', () => {
    const registration = watch(new FakeServiceWorkerContainer({}))

    vi.advanceTimersByTime(updateCheckIntervalMs - 1)
    expect(registration.update).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it("doesn't look while offline", () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const registration = watch(new FakeServiceWorkerContainer({}))

    setVisibility('visible')
    vi.advanceTimersByTime(updateCheckIntervalMs)

    expect(registration.update).not.toHaveBeenCalled()
  })
})
