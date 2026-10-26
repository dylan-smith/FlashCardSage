import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSpeechUrls } from '../api/speech'
import { forgetSpeech, loadSpeech, playSpeech } from '../practice/speech'

vi.mock('../api/speech', () => ({ getSpeechUrls: vi.fn() }))

const getUrls = vi.mocked(getSpeechUrls)

describe('loadSpeech', () => {
  beforeEach(() => {
    forgetSpeech()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('asks for the texts once, however often they are loaded', async () => {
    getUrls.mockResolvedValue(['https://audio.test/a.mp3'])

    const first = await loadSpeech(['hola'])
    const second = await loadSpeech(['hola'])

    expect(first).toEqual(['https://audio.test/a.mp3'])
    expect(second).toBe(first)
    expect(getUrls).toHaveBeenCalledTimes(1)
    expect(getUrls).toHaveBeenCalledWith(['hola'], false)
  })

  it('asks for the slow audio apart from the normal speed', async () => {
    getUrls.mockResolvedValue(['https://audio.test/a.mp3'])

    await loadSpeech(['hola'])
    await loadSpeech(['hola'], true)
    await loadSpeech(['hola'], true)

    expect(getUrls).toHaveBeenCalledTimes(2)
    expect(getUrls).toHaveBeenLastCalledWith(['hola'], true)
  })

  it('asks for each set of texts in its own right', async () => {
    getUrls.mockResolvedValue(['https://audio.test/a.mp3'])

    await loadSpeech(['hola'])
    await loadSpeech(['hola', 'adiós'])

    expect(getUrls).toHaveBeenCalledTimes(2)
  })

  it('asks again after a failure', async () => {
    getUrls.mockRejectedValueOnce(new Error('boom'))
    getUrls.mockResolvedValue(['https://audio.test/a.mp3'])

    await expect(loadSpeech(['hola'])).rejects.toThrow('boom')
    await expect(loadSpeech(['hola'])).resolves.toEqual([
      'https://audio.test/a.mp3',
    ])
    expect(getUrls).toHaveBeenCalledTimes(2)
  })
})

describe('playSpeech', () => {
  const urls = ['https://audio.test/a.mp3', 'https://audio.test/b.mp3']

  // The audio elements played, in order. jsdom has no playing of its own, so it's stood in for.
  function stubAudio() {
    const played: HTMLMediaElement[] = []
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      played.push(this)
      return Promise.resolve()
    })
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {})
    return { played, pause }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('plays the clips one after the other, and is done when the last ends', async () => {
    const { played } = stubAudio()
    let done = false

    const playback = playSpeech(urls)
    void playback.done.then(() => {
      done = true
    })
    await vi.waitFor(() => {
      expect(played).toHaveLength(1)
    })
    expect(played[0].src).toBe(urls[0])
    played[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => {
      expect(played).toHaveLength(2)
    })
    expect(played[1].src).toBe(urls[1])
    expect(done).toBe(false)

    played[1].dispatchEvent(new Event('ended'))

    await playback.done
    expect(done).toBe(true)
  })

  it('stops the clip playing and skips the rest', async () => {
    const { played, pause } = stubAudio()

    const playback = playSpeech(urls)
    await vi.waitFor(() => {
      expect(played).toHaveLength(1)
    })
    playback.stop()

    await playback.done
    expect(pause).toHaveBeenCalledTimes(1)
    expect(played).toHaveLength(1)
  })

  it("fails when a clip can't be played", async () => {
    const { played } = stubAudio()

    const playback = playSpeech(urls)
    await vi.waitFor(() => {
      expect(played).toHaveLength(1)
    })
    played[0].dispatchEvent(new Event('error'))

    await expect(playback.done).rejects.toThrow('Unable to play the audio.')
    expect(played).toHaveLength(1)
  })

  it('fails when the browser refuses to play', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new Error('NotAllowedError'),
    )

    await expect(playSpeech(urls).done).rejects.toThrow('NotAllowedError')
  })
})
