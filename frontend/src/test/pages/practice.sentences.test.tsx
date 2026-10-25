import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Deck } from '../../api/decks'
import type { Tag } from '../../api/flashCards'
import type { PackCard } from '../../api/practice'
import type { PracticeSentence } from '../../api/sentencePractice'
import { outcomes } from '../../components/practice/outcomes'
import { storageKeys } from '../../lib/storageKeys'
import { writeStoredPack } from '../../practice/pack'
import { forgetSpeech } from '../../practice/speech'
import { trackEvent, trackException } from '../../telemetry'
import { deck, packCard, pets } from '../support/factories'
import {
  emptyResponse,
  jsonResponse,
  mockApi,
  unreachable,
} from '../support/mockApi'
import type { CallLog, Routes } from '../support/mockApi'
import { goOffline, stubAudio, stubRandom } from '../support/practice'
import { renderAt, renderLoaded, signInForEachTest } from '../support/render'
import type { User } from '../support/render'

signInForEachTest()

// Whose cards the device keeps for the signed-in Tester.
const subject = 'test:tester'

const cat = packCard(1, 'el gato', 'the cat')
const dog = packCard(2, 'el perro', 'the dog')
const bird = packCard(3, 'el pájaro', 'the bird')
const animals = [cat, dog, bird]

const catSleeps: PracticeSentence = {
  spanish: 'El gato duerme.',
  english: 'The cat sleeps.',
  cardIds: [cat.id],
}
const dogEats: PracticeSentence = {
  spanish: 'El perro come.',
  english: 'The dog eats.',
  cardIds: [dog.id],
}
const birdSings: PracticeSentence = {
  spanish: 'El pájaro canta.',
  english: 'The bird sings.',
  cardIds: [bird.id],
}
const theyPlay: PracticeSentence = {
  spanish: 'El gato y el perro juegan.',
  english: 'The cat and the dog play.',
  cardIds: [cat.id, dog.id],
}
const iSeeTheBird: PracticeSentence = {
  spanish: 'Veo el pájaro.',
  english: 'I see the bird.',
  cardIds: [bird.id],
}
const handful = [catSleeps, dogEats, birdSings, theyPlay, iSeeTheBird]

const sentencesPath = '/flashcards/practice/sentences'
const resultsPath = '/flashcards/practice/sentences/results'

// Answers each request for sentences with the next of the lists, and with none once they've all been sent.
function batches(...lists: PracticeSentence[][]) {
  let next = 0
  return () => jsonResponse(lists[next++] ?? [])
}

// The requests for sentences, which are asked for in the background.
function sentenceRequests(background: CallLog) {
  return background.filter('GET', sentencesPath)
}

function sentResults(calls: CallLog) {
  return calls.filter('POST', resultsPath).map((call) => call.body)
}

function practicedCount() {
  return screen.getByText(/^Sentences practiced/)
}

function listeningSwitch() {
  return screen.getByRole('switch', { name: 'Listening mode' })
}

// Starts practicing sentences from the cards, each shown first on the side the roll picks (see stubRandom: 0 is
// Spanish and 0.6 English), with the API sending the sentences in turn.
async function practice(
  cards: PackCard[] = animals,
  {
    roll = 0,
    path = '/practice',
    decks = [],
    tags = [],
    sentences = batches(handful),
    routes = {},
  }: {
    roll?: number
    path?: string
    decks?: Deck[]
    tags?: Tag[]
    sentences?: unknown
    routes?: Routes
  } = {},
) {
  const random = stubRandom(roll)
  const view = await renderLoaded(path, {
    'GET /tags': tags,
    'GET /decks': decks,
    'GET /flashcards/practice/pack': { cards, decks, tags },
    [`GET ${sentencesPath}`]: sentences,
    [`POST ${resultsPath}`]: emptyResponse(204),
    ...routes,
  })
  return { ...view, random }
}

async function answer(user: User, label = 'Got it!') {
  await user.click(screen.getByRole('button', { name: 'Reveal' }))
  await user.click(screen.getByRole('button', { name: label }))
}

async function pick(user: User, option: string) {
  await user.click(screen.getByRole('combobox', { name: 'Practice' }))
  await user.click(
    within(screen.getByRole('listbox')).getByRole('option', { name: option }),
  )
}

beforeEach(() => {
  localStorage.setItem(storageKeys.practiceMode, '"sentences"')
  // Each test's audio is its own, not what an earlier test asked for.
  forgetSpeech()
})

describe('practice mode', () => {
  it('practices cards at first', async () => {
    localStorage.removeItem(storageKeys.practiceMode)
    const { background } = await practice()

    expect(screen.getByRole('tab', { name: 'Cards' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('el gato')).toBeInTheDocument()
    expect(sentenceRequests(background)).toHaveLength(0)
  })

  it('switches to sentences, and remembers it', async () => {
    localStorage.removeItem(storageKeys.practiceMode)
    const user = userEvent.setup()
    await practice()

    await user.click(screen.getByRole('tab', { name: 'Sentences' }))

    expect(await screen.findByText('El gato duerme.')).toBeInTheDocument()
    expect(screen.queryByText('el gato')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sentences' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(localStorage.getItem(storageKeys.practiceMode)).toBe('"sentences"')
    expect(trackEvent).toHaveBeenCalledWith('PracticeModeChanged', {
      mode: 'sentences',
    })

    await user.click(screen.getByRole('tab', { name: 'Cards' }))

    expect(await screen.findByText('el gato')).toBeInTheDocument()
    expect(localStorage.getItem(storageKeys.practiceMode)).toBe('"cards"')
  })

  it('stays on sentences when the page is opened again', async () => {
    await practice()

    expect(screen.getByRole('tab', { name: 'Sentences' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('El gato duerme.')).toBeInTheDocument()
  })

  it('stays on sentences when other cards are picked', async () => {
    const user = userEvent.setup()
    const { background } = await practice(animals, {
      decks: [deck(5, 'Animals', [bird.id, dog.id, cat.id])],
      sentences: batches(handful, [birdSings]),
    })

    await pick(user, 'Deck: Animals')

    expect(await screen.findByText('El pájaro canta.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sentences' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(sentenceRequests(background).at(-1)?.query.get('deckId')).toBe('5')
  })

  it('shares the listening mode switch with cards', async () => {
    stubAudio()
    const user = userEvent.setup()
    await practice(animals, {
      routes: { 'POST /speech': { urls: ['https://audio.test/gato.mp3'] } },
    })

    expect(listeningSwitch()).not.toBeChecked()
    expect(listeningSwitch()).toHaveAccessibleDescription(
      'Hear the Spanish before you see it.',
    )

    await user.click(listeningSwitch())

    expect(listeningSwitch()).toBeChecked()
    expect(localStorage.getItem(storageKeys.practiceListening)).toBe('true')
    expect(trackEvent).toHaveBeenCalledWith('PracticeListeningModeChanged', {
      on: 'true',
    })

    await user.click(screen.getByRole('tab', { name: 'Cards' }))

    expect(
      await screen.findByRole('switch', { name: 'Listening mode' }),
    ).toBeChecked()
    expect(screen.queryByText('el gato')).not.toBeInTheDocument()
  })
})

describe('listening mode', () => {
  const sentenceUrl = 'https://audio.test/gato-duerme.mp3'
  const speechRoutes = { 'POST /speech': { urls: [sentenceUrl] } }

  function finish(audio: HTMLMediaElement) {
    act(() => {
      audio.dispatchEvent(new Event('ended'))
    })
  }

  beforeEach(() => {
    localStorage.setItem(storageKeys.practiceListening, 'true')
  })

  it('is remembered, and plays the Spanish first even when the English was picked, hiding it until revealed', async () => {
    const { played } = stubAudio()
    const user = userEvent.setup()
    // Without listening mode the sentence would start in English.
    await practice(animals, { roll: 0.6, routes: speechRoutes })

    expect(listeningSwitch()).toBeChecked()
    await waitFor(() => {
      expect(played.map((audio) => audio.src)).toEqual([sentenceUrl])
    })
    finish(played[0])
    expect(screen.getByText('Spanish')).toBeInTheDocument()
    expect(screen.queryByText('El gato duerme.')).not.toBeInTheDocument()
    expect(screen.queryByText('The cat sleeps.')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Listen' })).toHaveClass(
      'MuiIconButton-sizeLarge',
    )

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(screen.getByText('El gato duerme.')).toBeInTheDocument()
    expect(screen.getByText('The cat sleeps.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Listen' })).not.toHaveClass(
      'MuiIconButton-sizeLarge',
    )
    // Not played again for the reveal.
    expect(played).toHaveLength(1)
  })

  it('records the Spanish as the side shown', async () => {
    stubAudio()
    const user = userEvent.setup()
    const { calls } = await practice(animals, {
      roll: 0.6,
      routes: speechRoutes,
    })

    await answer(user)

    await waitFor(() => {
      expect(practicedCount()).toHaveTextContent('Sentences practiced 1')
    })
    expect(sentResults(calls)).toEqual([
      {
        spanish: 'El gato duerme.',
        english: 'The cat sleeps.',
        cardIds: [cat.id],
        shownSide: 'Spanish',
        listening: true,
        outcome: 'GotIt',
      },
    ])
    expect(trackEvent).toHaveBeenCalledWith('SentencePracticeResultRecorded', {
      outcome: 'GotIt',
      shownSide: 'Spanish',
      listening: 'true',
    })
  })

  it('shows the side picked once turned off', async () => {
    stubAudio()
    const user = userEvent.setup()
    await practice(animals, { roll: 0.6, routes: speechRoutes })

    await user.click(listeningSwitch())

    expect(screen.getByText('The cat sleeps.')).toBeInTheDocument()
    expect(screen.queryByText('El gato duerme.')).not.toBeInTheDocument()
  })

  it('leaves the offline message in place of the sentence while offline', async () => {
    stubAudio()
    await practice(animals, { routes: speechRoutes })

    goOffline()

    expect(
      await screen.findByText(/^Sentences need a connection/),
    ).toBeInTheDocument()
    // The header, and so the switch, is only shown while there's a sentence to practice online.
    expect(
      screen.queryByRole('switch', { name: 'Listening mode' }),
    ).not.toBeInTheDocument()
  })
})

describe('practicing sentences', () => {
  it('shows one side of the sentence, then the other and the cards it uses once revealed', async () => {
    const user = userEvent.setup()
    await practice()

    expect(screen.getByText('El gato duerme.')).toHaveAttribute('lang', 'es')
    expect(screen.queryByText('The cat sleeps.')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Cards used' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Got it!' }),
    ).not.toBeInTheDocument()
    expect(practicedCount()).toHaveTextContent('Sentences practiced 0')

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(screen.getByText('El gato duerme.')).toBeInTheDocument()
    expect(screen.getByText('The cat sleeps.')).toHaveAttribute('lang', 'en')
    const used = within(screen.getByRole('list', { name: 'Cards used' }))
    expect(
      used.getAllByRole('listitem').map((item) => item.textContent),
    ).toEqual(['el gato'])
    expect(used.getByRole('listitem')).toHaveAttribute('lang', 'es')
    expect(screen.getByRole('button', { name: 'Got it!' })).toHaveFocus()
    expect(
      screen.queryByRole('button', { name: 'Reveal' }),
    ).not.toBeInTheDocument()
  })

  it('can show the English first', async () => {
    const user = userEvent.setup()
    await practice(animals, { roll: 0.6 })

    expect(screen.getByText('The cat sleeps.')).toBeInTheDocument()
    expect(screen.queryByText('El gato duerme.')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Listen' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(screen.getByText('El gato duerme.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
  })

  it('shows every card a sentence uses, in order, leaving out any not on the device', async () => {
    const user = userEvent.setup()
    await practice(animals, {
      sentences: batches([{ ...theyPlay, cardIds: [dog.id, 99, cat.id] }]),
    })

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(
      within(screen.getByRole('list', { name: 'Cards used' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['el perro', 'el gato'])
  })

  it('leaves out the cards used when none of them are on the device', async () => {
    const user = userEvent.setup()
    await practice(animals, {
      sentences: batches([{ ...catSleeps, cardIds: [99] }]),
    })

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(screen.getByText('The cat sleeps.')).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Cards used' }),
    ).not.toBeInTheDocument()
  })

  it("asks for the sentence's audio as soon as it comes up, and has Listen beside the Spanish", async () => {
    const { background } = await practice(animals, {
      routes: { 'POST /speech': { urls: ['https://audio.test/gato.mp3'] } },
    })

    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
    await waitFor(() => {
      expect(
        background.filter('POST', '/speech').map((call) => call.body),
      ).toEqual([{ texts: ['El gato duerme.'] }])
    })
  })

  it('shows a spinner while the sentences are being written', async () => {
    const { background } = mockApi({
      'GET /flashcards/practice/pack': { cards: animals, decks: [], tags: [] },
      [`GET ${sentencesPath}`]: () => new Promise<Response>(() => {}),
    })
    renderAt('/practice')

    await waitFor(() => {
      expect(sentenceRequests(background)).toHaveLength(1)
    })
    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reveal' }),
    ).not.toBeInTheDocument()
  })

  it.each(outcomes)(
    'records "$label" with the side shown, then shows the next sentence',
    async ({ outcome, label }) => {
      const user = userEvent.setup()
      const { calls } = await practice(animals, { roll: 0.6 })

      await answer(user, label)

      expect(await screen.findByText('The dog eats.')).toBeInTheDocument()
      expect(screen.queryByText('The cat sleeps.')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reveal' })).toHaveFocus()
      expect(practicedCount()).toHaveTextContent('Sentences practiced 1')
      expect(sentResults(calls)).toEqual([
        {
          spanish: 'El gato duerme.',
          english: 'The cat sleeps.',
          cardIds: [cat.id],
          shownSide: 'English',
          listening: false,
          outcome,
        },
      ])
      expect(trackEvent).toHaveBeenCalledWith(
        'SentencePracticeResultRecorded',
        { outcome, shownSide: 'English', listening: 'false' },
      )
    },
  )

  it('shows an error and keeps the sentence when saving the answer fails', async () => {
    const user = userEvent.setup()
    await practice(animals, {
      routes: { [`POST ${resultsPath}`]: emptyResponse(500) },
    })

    await answer(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to save your answer.',
    )
    expect(screen.getByText('El gato duerme.')).toBeInTheDocument()
    expect(screen.getByText('The cat sleeps.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Got it!' })).toBeEnabled()
    expect(practicedCount()).toHaveTextContent('Sentences practiced 0')
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'sentencePractice',
    })
    expect(trackEvent).not.toHaveBeenCalledWith(
      'SentencePracticeResultRecorded',
      expect.anything(),
    )
  })

  it('counts again from nothing when other cards are picked', async () => {
    const user = userEvent.setup()
    await practice(animals, {
      decks: [deck(5, 'Animals', [cat.id, dog.id, bird.id])],
      sentences: batches(handful, [iSeeTheBird, theyPlay, birdSings, dogEats]),
    })
    await answer(user)
    expect(await screen.findByText('El perro come.')).toBeInTheDocument()
    expect(practicedCount()).toHaveTextContent('Sentences practiced 1')

    await pick(user, 'Deck: Animals')

    expect(await screen.findByText('Veo el pájaro.')).toBeInTheDocument()
    expect(practicedCount()).toHaveTextContent('Sentences practiced 0')
  })

  describe('asking for more', () => {
    it('asks for more once only two are left after the one showing, one request at a time', async () => {
      const user = userEvent.setup()
      let release = () => {}
      let requests = 0
      const { background } = await practice(animals, {
        sentences: () => {
          requests++
          if (requests === 1) {
            return jsonResponse(handful)
          }
          return new Promise<Response>((resolve) => {
            release = () =>
              resolve(
                jsonResponse([
                  {
                    spanish: 'El perro duerme.',
                    english: 'The dog sleeps.',
                    cardIds: [dog.id],
                  },
                ]),
              )
          })
        },
      })

      await answer(user)
      expect(await screen.findByText('El perro come.')).toBeInTheDocument()
      expect(sentenceRequests(background)).toHaveLength(1)

      await answer(user)
      expect(await screen.findByText('El pájaro canta.')).toBeInTheDocument()
      await waitFor(() => {
        expect(sentenceRequests(background)).toHaveLength(2)
      })

      await answer(user)
      expect(
        await screen.findByText('El gato y el perro juegan.'),
      ).toBeInTheDocument()
      // The one on its way is still awaited, rather than asked for again.
      expect(sentenceRequests(background)).toHaveLength(2)

      release()
      await answer(user)
      await answer(user)

      expect(await screen.findByText('El perro duerme.')).toBeInTheDocument()
    })

    it("sends the deck's id", async () => {
      const { background } = await practice(animals, {
        path: '/practice?deck=5',
        decks: [deck(5, 'Animals', [cat.id, dog.id, bird.id])],
      })

      const [request] = sentenceRequests(background)
      expect(request.query.get('deckId')).toBe('5')
      expect(request.query.has('tagId')).toBe(false)
    })

    it("sends the tag's id", async () => {
      const tagged = animals.map((card) => ({ ...card, tagIds: [pets.id] }))
      const { background } = await practice(tagged, {
        path: '/practice?tag=4',
        tags: [pets],
      })

      const [request] = sentenceRequests(background)
      expect(request.query.get('tagId')).toBe('4')
      expect(request.query.has('deckId')).toBe(false)
    })

    it('says so when no sentences could be made, and can try again', async () => {
      const user = userEvent.setup()
      await practice(animals, { sentences: batches([], handful) })

      expect(
        screen.getByText(
          "Couldn't make any sentences from these cards right now.",
        ),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(await screen.findByText('El gato duerme.')).toBeInTheDocument()
    })

    it("says so when sentences aren't available", async () => {
      await practice(animals, { sentences: emptyResponse(503) })

      expect(
        screen.getByText("Sentences aren't available."),
      ).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument()
      expect(trackException).not.toHaveBeenCalled()
    })

    it('shows an error when making sentences fails, and can try again', async () => {
      const user = userEvent.setup()
      let requests = 0
      await practice(animals, {
        sentences: () =>
          ++requests === 1 ? emptyResponse(502) : jsonResponse(handful),
      })

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Unable to make sentences.',
      )
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'sentences',
      })

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(await screen.findByText('El gato duerme.')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('too few cards', () => {
    it('links to adding cards when there are none', async () => {
      const { background } = await practice([])

      expect(
        screen.getByText(
          'There are no flash cards to make sentences from yet.',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Add flash cards' }),
      ).toHaveAttribute('href', '/')
      expect(sentenceRequests(background)).toHaveLength(0)
    })

    it.each([
      {
        path: '/practice',
        message: 'Sentences need at least 3 cards, and you have 2.',
        link: 'Add flash cards',
      },
      {
        path: '/practice?deck=5',
        message: 'Sentences need at least 3 cards, and this deck has 2.',
        link: 'Edit decks',
      },
      {
        path: '/practice?tag=4',
        message: 'Sentences need at least 3 cards, and this tag has 1.',
        link: 'Manage cards',
      },
    ])('says so for $path', async ({ path, message, link }) => {
      const { background } = await practice(
        [cat, { ...dog, tagIds: [pets.id] }],
        { path, decks: [deck(5, 'Animals', [cat.id, dog.id])], tags: [pets] },
      )

      expect(screen.getByText(message)).toBeInTheDocument()
      expect(
        within(screen.getByRole('tabpanel')).getByRole('link', { name: link }),
      ).toBeInTheDocument()
      expect(sentenceRequests(background)).toHaveLength(0)
    })
  })

  describe('offline', () => {
    const offlineMessage =
      "Sentences need a connection, since they're written for you as you go. Switch to Cards to practice offline."

    it('keeps the sentences for when the user is back online', async () => {
      const { background } = await practice()

      const goOnline = goOffline()

      expect(await screen.findByText(offlineMessage)).toBeInTheDocument()
      expect(screen.queryByText('El gato duerme.')).not.toBeInTheDocument()

      goOnline()

      expect(await screen.findByText('El gato duerme.')).toBeInTheDocument()
      expect(sentenceRequests(background)).toHaveLength(1)
    })

    it('says so when opened offline', async () => {
      writeStoredPack(subject, { cards: animals, decks: [], tags: [] })
      goOffline()
      const { background } = await practice(animals, {
        routes: {
          'GET /decks': unreachable,
          'GET /tags': unreachable,
          'GET /flashcards/practice/pack': unreachable,
        },
      })

      expect(screen.getByText(offlineMessage)).toBeInTheDocument()
      expect(sentenceRequests(background)).toHaveLength(0)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
