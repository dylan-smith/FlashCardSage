import { getSpeechUrls } from '../api/speech'

// The spoken Spanish of the cards being practiced: where each card's audio is, and playing it.

export const playFailedMessage = 'Unable to play the audio.'

// The audio URLs asked for so far, by the texts they're for and how fast they're read, so a card's audio is asked for
// once however many times it's played or comes up, and so asking as soon as a card is shown makes pressing Listen
// play at once. The slow audio is only asked for when Listen slowly is pressed, since most cards never need it.
const loaded = new Map<string, Promise<string[]>>()

// Forgets the URLs asked for so far, for tests.
export function forgetSpeech() {
  loaded.clear()
}

// The URLs to play for these texts, in order. A request that fails isn't kept, so the next press asks again.
export function loadSpeech(texts: string[], slow = false): Promise<string[]> {
  const key = JSON.stringify({ texts, slow })
  let urls = loaded.get(key)
  if (urls === undefined) {
    urls = getSpeechUrls(texts, slow)
    urls.catch(() => loaded.delete(key))
    loaded.set(key, urls)
  }
  return urls
}

// Audio being played: done settles once the last clip has ended, or it's stopped, or a clip can't be played.
export type Playback = {
  done: Promise<void>
  stop: () => void
}

// Plays the clips one after the other, so a card's phrases are heard in order with a natural gap between them.
export function playSpeech(urls: string[]): Playback {
  let stopped = false
  let stopCurrent = () => {}
  const done = (async () => {
    for (const url of urls) {
      if (stopped) {
        return
      }
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(url)
        stopCurrent = () => {
          audio.pause()
          resolve()
        }
        audio.addEventListener('ended', () => resolve())
        audio.addEventListener('error', () =>
          reject(new Error(playFailedMessage)),
        )
        // Older browsers' play() returns nothing rather than a promise.
        Promise.resolve(audio.play()).catch((error: unknown) =>
          reject(error as Error),
        )
      })
    }
  })()
  return {
    done,
    stop: () => {
      stopped = true
      stopCurrent()
    },
  }
}
