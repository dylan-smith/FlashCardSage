import { act } from '@testing-library/react'
import { onTestFinished, vi } from 'vitest'

// Makes every roll the picker gets this, until it's changed: 0 picks the first card and its Spanish side, and 0.6 the
// second of two cards that are as likely as each other and its English side.
export function stubRandom(roll: number) {
  return vi.spyOn(Math, 'random').mockReturnValue(roll)
}

// The browser says it's offline until the returned function says it's online again.
export function goOffline() {
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
  onTestFinished(() => {
    window.dispatchEvent(new Event('online'))
  })
  return () => {
    onLine.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
  }
}

// The audio elements the page has played, in order. jsdom has no playing of its own, so it's stood in for.
export function stubAudio() {
  const played: HTMLMediaElement[] = []
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(function (this: HTMLMediaElement) {
      played.push(this)
      return Promise.resolve()
    })
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => {})
  return { played, play, pause }
}
