import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setSession } from '../auth/session'
import { features, headline } from '../pages/landingCopy'
import { renderAt, renderLoaded, stubMatchMedia } from './support/render'

afterEach(() => {
  // Signing out re-renders the app if a test left it mounted.
  act(() => setSession(null))
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function demos() {
  return screen.getAllByLabelText<HTMLVideoElement>(/^Demo: /)
}

describe('the landing page', () => {
  it('shows what the app does, a clip of each feature and the sign-in while signed out, and loads nothing', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    renderAt('/')

    expect(
      screen.getByRole('heading', { level: 2, name: headline }),
    ).toBeInTheDocument()
    for (const feature of features) {
      expect(
        screen.getByRole('heading', { level: 3, name: feature.title }),
      ).toBeInTheDocument()
      expect(
        screen.getByLabelText(`Demo: ${feature.title}`),
      ).toBeInTheDocument()
    }
    expect(
      screen.getByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: "Get started, it's free" }),
    ).toHaveAttribute('href', '#sign-in')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('plays each clip silently on a loop, with a poster', () => {
    renderAt('/')

    const clips = demos()
    expect(clips).toHaveLength(features.length)
    clips.forEach((clip, index) => {
      const feature = features[index]
      expect(clip.tagName).toBe('VIDEO')
      // React sets muted as a property rather than an attribute.
      expect(clip.muted).toBe(true)
      expect(clip).toHaveAttribute('loop')
      expect(clip).toHaveAttribute('playsinline')
      expect(clip).toHaveAttribute('autoplay')
      expect(clip).not.toHaveAttribute('controls')
      expect(clip).toHaveAttribute('poster', `${feature.demo}.jpg`)
      expect(clip).toContainHTML(
        `<source src="${feature.demo}.mp4" type="video/mp4">`,
      )
    })
  })

  it('leaves the clips still, with a play button, for someone who asks for less motion', () => {
    stubMatchMedia((query) => query === '(prefers-reduced-motion: reduce)')

    renderAt('/')

    for (const clip of demos()) {
      expect(clip).not.toHaveAttribute('autoplay')
      expect(clip).toHaveAttribute('controls')
      expect(clip).toHaveAttribute('preload', 'none')
    }
  })

  it('is shown at every address, so signing in lands on the page the visitor came to', () => {
    for (const path of ['/import?from=website&site=preply', '/authorize']) {
      const { unmount } = renderAt(path)
      expect(
        screen.getByRole('heading', { level: 2, name: headline }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { level: 2, name: 'Sign in' }),
      ).toBeInTheDocument()
      unmount()
    }
  })

  it('is gone once the user is signed in', async () => {
    setSession({ token: 'test:Tester', name: 'Tester', provider: 'test' })

    await renderLoaded('/')

    expect(
      screen.queryByRole('heading', { level: 2, name: headline }),
    ).not.toBeInTheDocument()
    expect(screen.queryAllByLabelText(/^Demo: /)).toHaveLength(0)
    expect(
      screen.getByRole('button', { name: 'Add flash card' }),
    ).toBeInTheDocument()
  })
})
