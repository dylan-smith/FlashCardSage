import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '../components/common/Toaster'
import { showToast, toastMs, toastWithActionMs } from '../toasts'

function renderToaster() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<p>Home</p>} />
        <Route path="/decks/3" element={<p>The deck</p>} />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  )
}

describe('toasts', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a toast, read out politely, and replaces one with the same key', () => {
    renderToaster()

    act(() => {
      showToast({ key: 'added', severity: 'success', message: 'Added 1 card.' })
      showToast({
        key: 'note',
        severity: 'info',
        message: 'A word is left out.',
      })
    })
    act(() => {
      showToast({
        key: 'added',
        severity: 'success',
        message: 'Added 2 cards.',
      })
    })

    const toasts = screen.getAllByRole('status')
    expect(toasts.map((toast) => toast.textContent)).toEqual([
      'A word is left out.',
      'Added 2 cards.',
    ])
  })

  it('goes by itself after a while', async () => {
    vi.useFakeTimers()
    renderToaster()
    act(() => {
      showToast({ key: 'added', severity: 'success', message: 'Added 1 card.' })
    })

    act(() => {
      vi.advanceTimersByTime(toastMs - 1)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Added 1 card.')
    // Its time, and then the slide out, which starts once it's closed.
    act(() => {
      vi.advanceTimersByTime(1)
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stays while the pointer is on it', () => {
    vi.useFakeTimers()
    renderToaster()
    act(() => {
      showToast({ key: 'added', severity: 'success', message: 'Added 1 card.' })
    })

    act(() => {
      screen
        .getByRole('status')
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      vi.advanceTimersByTime(toastMs * 2)
    })

    expect(screen.getByRole('status')).toHaveTextContent('Added 1 card.')
  })

  it('can be closed', async () => {
    const user = userEvent.setup()
    renderToaster()
    act(() => {
      showToast({ key: 'added', severity: 'success', message: 'Added 1 card.' })
    })

    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  it('has a link to follow, and stays longer for it', async () => {
    const user = userEvent.setup()
    renderToaster()
    act(() => {
      showToast({
        key: 'added',
        severity: 'success',
        message: 'Added Months with 12 cards.',
        action: { label: 'Open deck', to: '/decks/3' },
      })
    })
    expect(toastWithActionMs).toBeGreaterThan(toastMs)
    // It can still be closed without following the link.
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Open deck' }))

    expect(screen.getByText('The deck')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })
})
