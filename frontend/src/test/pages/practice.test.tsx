import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Deck } from '../../api/decks'
import type { Tag } from '../../api/flashCards'
import type { PackCard, PracticePack } from '../../api/practice'
import { defaultPreferences } from '../../api/preferences'
import { storageKeys } from '../../lib/storageKeys'
import { writeStoredPack } from '../../practice/pack'
import { enqueueResult, readQueue } from '../../practice/queue'
import { forgetSpeech } from '../../practice/speech'
import { trackEvent, trackException } from '../../telemetry'
import { deck, packCard, pets } from '../support/factories'
import {
  emptyResponse,
  jsonResponse,
  mockApi,
  unreachable,
} from '../support/mockApi'
import type { Call, CallLog, Routes } from '../support/mockApi'
import { renderAt, renderLoaded, signInForEachTest } from '../support/render'

signInForEachTest()

// Whose cards and answers the device keeps for the signed-in Tester.
const subject = 'test:tester'

const cat = packCard(1, 'el gato', 'the cat')
const dog = packCard(2, 'el perro', 'the dog')

function packOf(
  cards: PackCard[],
  { decks = [], tags = [] }: { decks?: Deck[]; tags?: Tag[] } = {},
): PracticePack {
  return { cards, decks, tags }
}

// Makes every roll the picker gets this, until it's changed: 0 picks the first card and its Spanish side, and 0.6 the
// second of two cards that are as likely as each other and its English side.
function stubRandom(roll: number) {
  return vi.spyOn(Math, 'random').mockReturnValue(roll)
}

// The browser says it's offline until the returned function says it's online again.
function goOffline() {
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

// The answers sent to be saved.
function sentResults(calls: CallLog) {
  return calls
    .filter('POST', '/flashcards/practice-results')
    .flatMap((call) => (call.body as { results: unknown[] }).results)
}

describe('practicing', () => {
  // Starts practicing the cards, picked with the roll (see stubRandom), and answers each request to save answers with
  // the status.
  async function practice(
    cards: PackCard[],
    {
      roll = 0,
      status = 200,
      path = '/practice',
      tags = [],
      decks = [],
      routes = {},
    }: {
      roll?: number
      status?: number
      path?: string
      tags?: Tag[]
      decks?: Deck[]
      routes?: Routes
    } = {},
  ) {
    const random = stubRandom(roll)
    const { calls, background } = await renderLoaded(path, {
      'GET /tags': tags,
      'GET /decks': decks,
      'GET /flashcards/practice/pack': packOf(cards, { decks, tags }),
      'POST /flashcards/practice-results': (call: Call) =>
        status === 200
          ? jsonResponse({
              accepted: (call.body as { results: unknown[] }).results.length,
            })
          : emptyResponse(status),
      ...routes,
    })
    return { calls, background, random }
  }

  it('shows every word on each side of a card with more than one translation', async () => {
    const user = userEvent.setup()
    await practice([packCard(3, ['solo', 'únicamente'], 'only')], {
      roll: 0.6,
    })

    expect(screen.getByText('only')).toHaveAttribute('lang', 'en')
    expect(screen.queryByText('solo / únicamente')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(screen.getByText('solo / únicamente')).toHaveAttribute('lang', 'es')
  })

  it('shows the Spanish of the card picked until it is revealed', async () => {
    const user = userEvent.setup()
    const { calls } = await practice([cat])

    expect(calls.some('GET', '/flashcards/practice/next')).toBe(false)
    expect(screen.getByText('el gato')).toHaveAttribute('lang', 'es')
    expect(screen.queryByText('the cat')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Got it!' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(screen.getByText('el gato')).toBeInTheDocument()
    expect(screen.getByText('the cat')).toHaveAttribute('lang', 'en')
    expect(screen.getByRole('button', { name: 'Got it!' })).toHaveFocus()
    expect(
      screen.getByRole('button', { name: 'I was close' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Failed :(' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reveal' }),
    ).not.toBeInTheDocument()
  })

  it('can show the English side first', async () => {
    const user = userEvent.setup()
    await practice([cat, dog], { roll: 0.6 })

    expect(screen.getByText('the dog')).toBeInTheDocument()
    expect(screen.queryByText('el perro')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(screen.getByText('el perro')).toBeInTheDocument()
  })

  it("shows the card's picture only once it's revealed", async () => {
    const user = userEvent.setup()
    await practice([{ ...cat, imageUrl: 'http://images.test/1.png' }])

    expect(
      screen.queryByRole('img', { name: 'Picture for "el gato"' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(
      screen.getByRole('img', { name: 'Picture for "el gato"' }),
    ).toHaveAttribute('src', 'http://images.test/1.png')
  })

  it('shows no picture for a card without one', async () => {
    const user = userEvent.setup()
    await practice([cat])

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(
      screen.queryByRole('img', { name: /^Picture for/ }),
    ).not.toBeInTheDocument()
  })

  it('shows no picture when the user turned pictures off', async () => {
    const user = userEvent.setup()
    await practice([{ ...cat, imageUrl: 'http://images.test/1.png' }], {
      routes: {
        'GET /preferences': { ...defaultPreferences, showPictures: false },
      },
    })

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(screen.getByText('the cat')).toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: /^Picture for/ }),
    ).not.toBeInTheDocument()
  })

  it.each([
    ['Got it!', 'GotIt'],
    ['I was close', 'WasClose'],
    ['Failed :(', 'Failed'],
  ])(
    'records "%s" for the card, then shows another one',
    async (label, outcome) => {
      const user = userEvent.setup()
      const { calls, random } = await practice([cat, dog])

      await user.click(screen.getByRole('button', { name: 'Reveal' }))
      random.mockReturnValue(0.6)
      await user.click(screen.getByRole('button', { name: label }))

      expect(await screen.findByText('the dog')).toBeInTheDocument()
      expect(screen.queryByText('el perro')).not.toBeInTheDocument()
      expect(screen.queryByText('el gato')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reveal' })).toHaveFocus()
      await waitFor(() => {
        expect(sentResults(calls)).toEqual([
          {
            id: expect.any(String) as string,
            flashCardId: cat.id,
            outcome,
            practicedAt: expect.any(String) as string,
          },
        ])
      })
      expect(readQueue(subject)).toEqual([])
      expect(trackEvent).toHaveBeenCalledWith('PracticeResultRecorded', {
        outcome,
      })
    },
  )

  it('can be given the same card again', async () => {
    const user = userEvent.setup()
    await practice([cat])

    await user.click(screen.getByRole('button', { name: 'Reveal' }))
    await user.click(screen.getByRole('button', { name: 'Got it!' }))

    expect(
      await screen.findByRole('button', { name: 'Reveal' }),
    ).toBeInTheDocument()
    expect(screen.getByText('el gato')).toBeInTheDocument()
    expect(screen.queryByText('the cat')).not.toBeInTheDocument()
  })

  it('adds up how much each answer changes the score into a session score', async () => {
    const user = userEvent.setup()
    await practice([{ ...cat, score: 50 }])

    expect(screen.getByText(/^Session score/)).toHaveTextContent(
      'Session score 0',
    )

    // 50 goes to 80, then 90, then 0, then 50.
    for (const [label, expected] of [
      ['Got it!', '+30'],
      ['Got it!', '+40'],
      ['Failed :(', '-50'],
      ['Got it!', '0'],
    ]) {
      await user.click(screen.getByRole('button', { name: 'Reveal' }))
      await user.click(screen.getByRole('button', { name: label }))
      await waitFor(() => {
        expect(screen.getByText(/^Session score/)).toHaveTextContent(
          `Session score ${expected}`,
        )
      })
    }
  })

  it('practices the answers on the device that are not saved yet', async () => {
    // The pack says the cat has never been got right, but an answer on the device has.
    enqueueResult(subject, cat.id, 'GotIt', new Date().toISOString())
    const user = userEvent.setup()
    await practice([cat], {
      // Keeps the answer on the device, so it's still not saved.
      routes: { 'POST /flashcards/practice-results': unreachable },
    })

    await user.click(screen.getByRole('button', { name: 'Reveal' }))
    await user.click(screen.getByRole('button', { name: 'Got it!' }))

    // 50 to 80, rather than 0 to 50.
    await waitFor(() => {
      expect(screen.getByText(/^Session score/)).toHaveTextContent(
        'Session score +30',
      )
    })
  })

  // The answer couldn't be kept on the device, such as when its storage is full.
  function failSaving() {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
  }

  it('keeps the session score when saving the answer fails', async () => {
    const user = userEvent.setup()
    await practice([cat])
    failSaving()

    await user.click(screen.getByRole('button', { name: 'Reveal' }))
    await user.click(screen.getByRole('button', { name: 'Got it!' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/^Session score/)).toHaveTextContent(
      'Session score 0',
    )
  })

  it('shows an error and keeps the card when saving the answer fails', async () => {
    const user = userEvent.setup()
    const { calls } = await practice([cat])
    failSaving()

    await user.click(screen.getByRole('button', { name: 'Reveal' }))
    await user.click(screen.getByRole('button', { name: 'Got it!' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to save your answer.',
    )
    expect(screen.getByText('el gato')).toBeInTheDocument()
    expect(screen.getByText('the cat')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Got it!' })).toBeEnabled()
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'practice',
    })
    expect(trackEvent).not.toHaveBeenCalledWith(
      'PracticeResultRecorded',
      expect.anything(),
    )
    expect(calls.some('POST', '/flashcards/practice-results')).toBe(false)
  })

  it('links to adding cards when there are none', async () => {
    await practice([])

    expect(
      screen.getByText('There are no flash cards to practice yet.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Add flash cards' }),
    ).toHaveAttribute('href', '/')
  })

  describe('picking what to practice', () => {
    const animals = deck(3, 'Animals', [dog.id])

    it('offers every card, the decks and the tags, and practices the one picked', async () => {
      const user = userEvent.setup()
      await practice([cat, dog], { decks: [animals], tags: [pets] })
      await user.click(screen.getByRole('button', { name: 'Reveal' }))
      await user.click(screen.getByRole('button', { name: 'Got it!' }))
      await waitFor(() => {
        expect(screen.getByText(/^Session score/)).toHaveTextContent(
          'Session score +50',
        )
      })

      await user.click(screen.getByRole('combobox', { name: 'Practice' }))
      const listbox = screen.getByRole('listbox')
      expect(
        within(listbox)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['All cards', 'Deck: Animals', 'Tag: Pets'])
      await user.click(
        within(listbox).getByRole('option', { name: 'Deck: Animals' }),
      )

      // A new session for the deck, which only has the dog.
      expect(await screen.findByText('el perro')).toBeInTheDocument()
      expect(screen.getByText(/^Session score/)).toHaveTextContent(
        'Session score 0',
      )
      expect(
        screen.getByRole('combobox', { name: 'Practice' }),
      ).toHaveTextContent('Deck: Animals')
    })

    it('practices the deck in the URL', async () => {
      const user = userEvent.setup()
      const { calls } = await practice([cat, dog], {
        path: '/practice?deck=3',
        decks: [animals],
      })

      expect(screen.getByText('el perro')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Reveal' }))
      await user.click(screen.getByRole('button', { name: 'Got it!' }))

      // The deck's only card, again.
      await waitFor(() => {
        expect(sentResults(calls)).toEqual([
          expect.objectContaining({ flashCardId: dog.id }),
        ])
      })
      expect(screen.getByText('el perro')).toBeInTheDocument()
    })

    it('practices the tag in the URL', async () => {
      await practice([cat, { ...dog, tagIds: [pets.id] }], {
        path: '/practice?tag=4',
        tags: [pets],
      })

      expect(screen.getByText('el perro')).toBeInTheDocument()
      expect(
        screen.getByRole('combobox', { name: 'Practice' }),
      ).toHaveTextContent('Tag: Pets')
    })

    it('practices every card when the deck in the URL is gone', async () => {
      await practice([cat, dog], {
        path: '/practice?deck=99',
        decks: [animals],
      })

      expect(screen.getByText('el gato')).toBeInTheDocument()
      expect(
        screen.getByRole('combobox', { name: 'Practice' }),
      ).toHaveTextContent('All cards')
    })

    it('links to the decks when the deck has no cards', async () => {
      await practice([cat], {
        path: '/practice?deck=3',
        decks: [deck(3, 'Animals')],
      })

      expect(
        screen.getByText('There are no cards in this deck.'),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Edit decks' })).toHaveAttribute(
        'href',
        '/decks',
      )
    })

    it('says so when the tag has no cards', async () => {
      await practice([cat], { path: '/practice?tag=4', tags: [pets] })

      expect(
        screen.getByText('There are no cards with this tag.'),
      ).toBeInTheDocument()
    })

    it('leaves out the picker when there are no decks or tags', async () => {
      await practice([cat])

      expect(
        screen.queryByRole('combobox', { name: 'Practice' }),
      ).not.toBeInTheDocument()
    })

    it("offers the decks and tags on the device when the API can't be reached", async () => {
      writeStoredPack(subject, packOf([cat, dog], { decks: [animals] }))
      const user = userEvent.setup()
      await practice([cat, dog], {
        decks: [animals],
        routes: { 'GET /decks': unreachable, 'GET /tags': unreachable },
      })

      await user.click(screen.getByRole('combobox', { name: 'Practice' }))

      expect(
        within(screen.getByRole('listbox'))
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['All cards', 'Deck: Animals'])
      expect(trackException).not.toHaveBeenCalled()
    })
  })

  describe('listening', () => {
    const gatoUrl = 'https://audio.test/gato.mp3'
    const soloUrls = [
      'https://audio.test/solo.mp3',
      'https://audio.test/unicamente.mp3',
    ]

    // The audio elements the page has played, in order. jsdom has no playing of its own, so it's stood in for.
    function stubAudio() {
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

    // The clip finishes, or can't be played.
    function finish(audio: HTMLMediaElement, event = 'ended') {
      act(() => {
        audio.dispatchEvent(new Event(event))
      })
    }

    beforeEach(() => {
      // Each test's audio is its own, not what an earlier test asked for.
      forgetSpeech()
    })

    it('asks for the audio as soon as the card comes up, and has Listen beside the Spanish', async () => {
      const { background } = await practice([cat], {
        routes: { 'POST /speech': { urls: [gatoUrl] } },
      })

      expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled()
      await waitFor(() => {
        expect(
          background.filter('POST', '/speech').map((call) => call.body),
        ).toEqual([{ texts: ['el gato'] }])
      })
    })

    it('plays each Spanish word or phrase in turn when Listen is pressed', async () => {
      const { played } = stubAudio()
      const user = userEvent.setup()
      const { background } = await practice(
        [packCard(3, ['solo', 'únicamente'], 'only')],
        { routes: { 'POST /speech': { urls: soloUrls } } },
      )

      await user.click(screen.getByRole('button', { name: 'Listen' }))

      await waitFor(() => {
        expect(played.map((audio) => audio.src)).toEqual([soloUrls[0]])
      })
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
      finish(played[0])
      await waitFor(() => {
        expect(played.map((audio) => audio.src)).toEqual(soloUrls)
      })
      finish(played[1])
      expect(
        await screen.findByRole('button', { name: 'Listen' }),
      ).toBeInTheDocument()
      // Asked for once, when the card came up, not again for the press.
      expect(background.filter('POST', '/speech')).toHaveLength(1)
    })

    it('shows Listen for a card that starts in English once it is revealed', async () => {
      const user = userEvent.setup()
      const { background } = await practice([cat, dog], {
        roll: 0.6,
        routes: { 'POST /speech': { urls: [gatoUrl] } },
      })

      expect(
        screen.queryByRole('button', { name: 'Listen' }),
      ).not.toBeInTheDocument()
      // Asked for all the same, so it's ready when the card is revealed.
      await waitFor(() => {
        expect(background.some('POST', '/speech')).toBe(true)
      })

      await user.click(screen.getByRole('button', { name: 'Reveal' }))

      expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
    })

    it('stops the audio when Stop is pressed', async () => {
      const { played, pause } = stubAudio()
      const user = userEvent.setup()
      await practice([packCard(3, ['solo', 'únicamente'], 'only')], {
        routes: { 'POST /speech': { urls: soloUrls } },
      })

      await user.click(screen.getByRole('button', { name: 'Listen' }))
      await user.click(await screen.findByRole('button', { name: 'Stop' }))

      expect(
        await screen.findByRole('button', { name: 'Listen' }),
      ).toBeInTheDocument()
      expect(played).toHaveLength(1)
      expect(pause).toHaveBeenCalledTimes(1)
    })

    it("says when audio isn't available", async () => {
      stubAudio()
      const user = userEvent.setup()
      await practice([cat])

      await user.click(screen.getByRole('button', { name: 'Listen' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Audio isn't available.",
      )
      expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
      expect(trackException).not.toHaveBeenCalled()
    })

    it("says when the audio can't be played", async () => {
      const { played } = stubAudio()
      const user = userEvent.setup()
      await practice([cat], {
        routes: { 'POST /speech': { urls: [gatoUrl] } },
      })

      await user.click(screen.getByRole('button', { name: 'Listen' }))
      await waitFor(() => {
        expect(played).toHaveLength(1)
      })
      finish(played[0], 'error')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Unable to play the audio.',
      )
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'speech',
      })
    })

    it('turns Listen off while offline', async () => {
      await practice([cat], {
        routes: { 'POST /speech': { urls: [gatoUrl] } },
      })

      const backOnline = goOffline()

      expect(screen.getByRole('button', { name: 'Listen' })).toBeDisabled()
      backOnline()
      expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled()
    })

    describe('listening mode', () => {
      const dogUrl = 'https://audio.test/perro.mp3'
      const speech = (call: Call) =>
        jsonResponse({
          urls: [
            (call.body as { texts: string[] }).texts[0] === 'el gato'
              ? gatoUrl
              : dogUrl,
          ],
        })

      function listeningSwitch() {
        return screen.getByRole('switch', { name: 'Listening mode' })
      }

      it('is off at first, and hides the Spanish once turned on', async () => {
        const user = userEvent.setup()
        await practice([cat], { routes: { 'POST /speech': speech } })

        expect(listeningSwitch()).not.toBeChecked()
        expect(screen.getByText('el gato')).toBeInTheDocument()

        await user.click(listeningSwitch())

        expect(listeningSwitch()).toBeChecked()
        expect(screen.queryByText('el gato')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled()
        expect(localStorage.getItem(storageKeys.practiceListening)).toBe('true')
        expect(trackEvent).toHaveBeenCalledWith(
          'PracticeListeningModeChanged',
          { on: 'true' },
        )
      })

      it('stays on when the page is opened again', async () => {
        stubAudio()
        localStorage.setItem(storageKeys.practiceListening, 'true')
        await practice([cat], { routes: { 'POST /speech': speech } })

        expect(listeningSwitch()).toBeChecked()
        expect(screen.queryByText('el gato')).not.toBeInTheDocument()
      })

      it('plays the Spanish as each card comes up, and shows both sides once revealed', async () => {
        const { played } = stubAudio()
        localStorage.setItem(storageKeys.practiceListening, 'true')
        const user = userEvent.setup()
        // The second card would start in English without listening mode.
        const { random } = await practice([cat, dog], {
          routes: { 'POST /speech': speech },
        })

        await waitFor(() => {
          expect(played.map((audio) => audio.src)).toEqual([gatoUrl])
        })
        finish(played[0])
        expect(screen.queryByText('el gato')).not.toBeInTheDocument()
        expect(screen.queryByText('the cat')).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Reveal' }))

        expect(screen.getByText('el gato')).toBeInTheDocument()
        expect(screen.getByText('the cat')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Got it!' })).toBeEnabled()
        // Not played again for the reveal.
        expect(played).toHaveLength(1)

        random.mockReturnValue(0.6)
        await user.click(screen.getByRole('button', { name: 'Got it!' }))

        expect(screen.queryByText('the dog')).not.toBeInTheDocument()
        expect(screen.queryByText('el perro')).not.toBeInTheDocument()
        await waitFor(() => {
          expect(played.map((audio) => audio.src)).toEqual([gatoUrl, dogUrl])
        })
      })

      it("shows no error when the browser won't play the audio by itself", async () => {
        const { played, play } = stubAudio()
        play.mockImplementationOnce(() =>
          Promise.reject(new DOMException('Not allowed', 'NotAllowedError')),
        )
        localStorage.setItem(storageKeys.practiceListening, 'true')
        const user = userEvent.setup()
        await practice([cat], { routes: { 'POST /speech': speech } })

        const listen = await screen.findByRole('button', { name: 'Listen' })
        await waitFor(() => {
          expect(listen).not.toHaveAttribute('aria-busy', 'true')
        })
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(trackException).not.toHaveBeenCalled()

        await user.click(listen)

        await waitFor(() => {
          expect(played.map((audio) => audio.src)).toEqual([gatoUrl])
        })
      })

      it('shows the side picked for each card while offline', async () => {
        const { played } = stubAudio()
        localStorage.setItem(storageKeys.practiceListening, 'true')
        await practice([cat, dog], {
          roll: 0.6,
          routes: { 'POST /speech': speech },
        })
        await waitFor(() => {
          expect(played).toHaveLength(1)
        })
        finish(played[0])

        const backOnline = goOffline()

        expect(screen.getByText('the dog')).toBeInTheDocument()
        expect(screen.queryByText('el perro')).not.toBeInTheDocument()
        expect(listeningSwitch()).toBeChecked()
        expect(
          screen.getByText(/Listening mode needs a connection/),
        ).toBeInTheDocument()

        backOnline()

        expect(screen.queryByText('the dog')).not.toBeInTheDocument()
        expect(
          screen.queryByText(/Listening mode needs a connection/),
        ).not.toBeInTheDocument()
        await waitFor(() => {
          expect(played).toHaveLength(2)
        })
      })
    })
  })

  describe('offline', () => {
    it('keeps the answers on the device, and saves them once back online', async () => {
      const user = userEvent.setup()
      const { calls, random } = await practice([cat, dog])
      const goOnline = goOffline()
      const status = screen.getByRole('status')
      // The note subscribes to the online state in an effect, which may run after the event.
      await waitFor(() => {
        expect(status).toHaveTextContent(
          "Offline – your answers will be saved when you're back online.",
        )
      })

      await user.click(screen.getByRole('button', { name: 'Reveal' }))
      random.mockReturnValue(0.6)
      await user.click(screen.getByRole('button', { name: 'Got it!' }))

      expect(await screen.findByText('the dog')).toBeInTheDocument()
      expect(screen.getByText(/^Session score/)).toHaveTextContent(
        'Session score +50',
      )
      await waitFor(() => {
        expect(status).toHaveTextContent(
          "Offline – 1 answer will be saved when you're back online.",
        )
      })
      expect(readQueue(subject)).toEqual([
        expect.objectContaining({ flashCardId: cat.id, outcome: 'GotIt' }),
      ])
      expect(calls.some('POST', '/flashcards/practice-results')).toBe(false)

      goOnline()

      await waitFor(() => {
        expect(sentResults(calls)).toEqual([
          expect.objectContaining({ flashCardId: cat.id, outcome: 'GotIt' }),
        ])
      })
      await waitFor(() => {
        expect(status).toHaveTextContent(/^$/)
      })
      expect(readQueue(subject)).toEqual([])
    })

    it('says how many answers are waiting when they could not be saved', async () => {
      const user = userEvent.setup()
      await practice([cat], { status: 500 })

      await user.click(screen.getByRole('button', { name: 'Reveal' }))
      await user.click(screen.getByRole('button', { name: 'Got it!' }))

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(
          "1 answer couldn't be saved yet. They'll be saved when FlashCardSage can be reached.",
        )
      })
      expect(readQueue(subject)).toHaveLength(1)
    })

    it('practices the cards on the device', async () => {
      writeStoredPack(
        subject,
        packOf([cat, dog], { decks: [deck(3, 'Animals', [dog.id])] }),
      )
      goOffline()
      stubRandom(0)
      const { background } = await renderLoaded('/practice?deck=3', {
        'GET /decks': unreachable,
        'GET /tags': unreachable,
        'GET /flashcards/practice/pack': unreachable,
      })

      expect(screen.getByText('el perro')).toBeInTheDocument()
      expect(
        screen.getByRole('combobox', { name: 'Practice' }),
      ).toHaveTextContent('Deck: Animals')
      expect(background.some('GET', '/flashcards/practice/pack')).toBe(false)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it("says so when the cards aren't on the device", async () => {
      goOffline()
      await renderLoaded('/practice', {
        'GET /decks': unreachable,
        'GET /tags': unreachable,
        'GET /flashcards/practice/pack': unreachable,
      })

      expect(
        screen.getByText(
          "Your cards aren't on this device yet. Open Practice once while you're online, and you can practice offline after that.",
        ),
      ).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('keeps the answers on the device when the sign-in has expired', async () => {
      const user = userEvent.setup()
      const { calls } = await practice([cat], { status: 401 })

      await user.click(screen.getByRole('button', { name: 'Reveal' }))
      await user.click(screen.getByRole('button', { name: 'Got it!' }))

      await waitFor(() => {
        expect(sentResults(calls)).toHaveLength(1)
      })
      expect(readQueue(subject)).toEqual([
        expect.objectContaining({ flashCardId: cat.id, outcome: 'GotIt' }),
      ])
    })
  })

  it('shows an error when loading fails', async () => {
    mockApi({ 'GET /flashcards/practice/pack': emptyResponse(500) })
    renderAt('/practice')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to load flash cards.',
    )
    expect(
      screen.queryByText('There are no flash cards to practice yet.'),
    ).not.toBeInTheDocument()
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'load',
    })
  })
})
