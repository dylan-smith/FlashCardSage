import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Deck } from '../../api/decks'
import type { Tag } from '../../api/flashCards'
import { defaultPreferences } from '../../api/preferences'
import { trackEvent, trackException } from '../../telemetry'
import { api, cat, deck, dog, pets } from '../support/factories'
import { emptyResponse, jsonResponse, mockApi } from '../support/mockApi'
import type { CallLog, Routes } from '../support/mockApi'
import { renderAt, renderLoaded, signInForEachTest } from '../support/render'

signInForEachTest()

describe('practicing', () => {
  // Starts on the first card the API picks, then answers each saved result with the next card it picks, or with
  // the status when it isn't saved.
  async function practice(
    first: unknown,
    {
      next = { ...dog, side: 'Spanish' },
      status = 200,
      scoreChanges = [0],
      path = '/practice',
      tags = [],
      decks = [],
      routes = {},
    }: {
      next?: unknown
      status?: number
      scoreChanges?: number[]
      path?: string
      tags?: Tag[]
      decks?: Deck[]
      routes?: Routes
    } = {},
  ) {
    let answers = 0
    const { calls } = await renderLoaded(path, {
      'GET /tags': tags,
      'GET /decks': decks,
      'GET /flashcards/practice/next':
        first === null ? emptyResponse(204) : first,
      'POST /flashcards/:id/practice-results': () => {
        // Each answer gets the next score change, and the last one after that.
        const scoreChange =
          scoreChanges[Math.min(answers++, scoreChanges.length - 1)]
        return status === 200
          ? jsonResponse({ next, scoreChange })
          : emptyResponse(status)
      },
      ...routes,
    })
    return calls
  }

  // The urls the page asked for its practice cards from, in order.
  function nextUrls(calls: CallLog) {
    return calls
      .filter('GET', '/flashcards/practice/next')
      .map((call) => call.url)
  }

  it('shows every word on each side of a card with more than one translation', async () => {
    const user = userEvent.setup()
    await practice({
      id: 3,
      spanish: ['solo', 'únicamente'],
      english: ['only'],
      side: 'English',
    })

    expect(screen.getByText('only')).toHaveAttribute('lang', 'en')
    expect(screen.queryByText('solo / únicamente')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(screen.getByText('solo / únicamente')).toHaveAttribute('lang', 'es')
  })

  it('shows the Spanish of the card the API picks until it is revealed', async () => {
    const user = userEvent.setup()
    const calls = await practice({ ...cat, side: 'Spanish' })

    expect(nextUrls(calls)).toEqual([api('/flashcards/practice/next')])
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
    await practice({ ...dog, side: 'English' })

    expect(screen.getByText('the dog')).toBeInTheDocument()
    expect(screen.queryByText('el perro')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(screen.getByText('el perro')).toBeInTheDocument()
  })

  it("shows the card's picture only once it's revealed", async () => {
    const user = userEvent.setup()
    await practice({
      ...cat,
      side: 'Spanish',
      imageUrl: 'http://images.test/1.png',
    })

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
    await practice({ ...cat, side: 'Spanish', imageUrl: null })

    await user.click(screen.getByRole('button', { name: 'Reveal' }))

    expect(
      screen.queryByRole('img', { name: /^Picture for/ }),
    ).not.toBeInTheDocument()
  })

  it('shows no picture when the user turned pictures off', async () => {
    const user = userEvent.setup()
    await practice(
      {
        ...cat,
        side: 'Spanish',
        imageUrl: 'http://images.test/1.png',
      },
      {
        routes: {
          'GET /preferences': { ...defaultPreferences, showPictures: false },
        },
      },
    )

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
    'records "%s" for the card, then shows the one the API picks next',
    async (label, outcome) => {
      const user = userEvent.setup()
      const calls = await practice(
        { ...cat, side: 'Spanish' },
        { next: { ...dog, side: 'English' } },
      )

      await user.click(screen.getByRole('button', { name: 'Reveal' }))
      await user.click(screen.getByRole('button', { name: label }))

      expect(await screen.findByText('the dog')).toBeInTheDocument()
      expect(screen.queryByText('el perro')).not.toBeInTheDocument()
      expect(screen.queryByText('el gato')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reveal' })).toHaveFocus()
      const post = calls.find('POST')
      expect(post?.url).toBe(api('/flashcards/1/practice-results'))
      expect(post?.init?.body).toBe(JSON.stringify({ outcome }))
      expect(trackEvent).toHaveBeenCalledWith('PracticeResultRecorded', {
        outcome,
      })
    },
  )

  it('can be given the same card again', async () => {
    const user = userEvent.setup()
    await practice(
      { ...cat, side: 'Spanish' },
      { next: { ...cat, side: 'Spanish' } },
    )

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
    await practice(
      { ...cat, side: 'Spanish' },
      { next: { ...cat, side: 'Spanish' }, scoreChanges: [50, 30, -80] },
    )

    expect(screen.getByText(/^Session score/)).toHaveTextContent(
      'Session score 0',
    )

    for (const [label, expected] of [
      ['Got it!', '+50'],
      ['Got it!', '+80'],
      ['Failed :(', '0'],
      ['Failed :(', '-80'],
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

  it('keeps the session score when saving the answer fails', async () => {
    const user = userEvent.setup()
    await practice({ ...cat, side: 'Spanish' }, { status: 500 })

    await user.click(screen.getByRole('button', { name: 'Reveal' }))
    await user.click(screen.getByRole('button', { name: 'Got it!' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/^Session score/)).toHaveTextContent(
      'Session score 0',
    )
  })

  it('shows an error and keeps the card when saving the answer fails', async () => {
    const user = userEvent.setup()
    await practice({ ...cat, side: 'Spanish' }, { status: 500 })

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
  })

  it('links to adding cards when there are none', async () => {
    await practice(null)

    expect(
      screen.getByText('There are no flash cards to practice yet.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Add flash cards' }),
    ).toHaveAttribute('href', '/')
  })

  describe('picking what to practice', () => {
    const animals = deck(3, 'Animals', [1, 2])

    it('offers every card, the decks and the tags, and practices the one picked', async () => {
      const user = userEvent.setup()
      const calls = await practice(
        { ...cat, side: 'Spanish' },
        { decks: [animals], tags: [pets], scoreChanges: [50] },
      )
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

      await waitFor(() => {
        expect(nextUrls(calls)).toContain(
          api('/flashcards/practice/next?deckId=3'),
        )
      })
      // A new session for the deck.
      expect(await screen.findByText(/^Session score/)).toHaveTextContent(
        'Session score 0',
      )
      expect(
        screen.getByRole('combobox', { name: 'Practice' }),
      ).toHaveTextContent('Deck: Animals')
    })

    it('practices the deck in the URL, and records answers with it', async () => {
      const user = userEvent.setup()
      const calls = await practice(
        { ...cat, side: 'Spanish' },
        { path: '/practice?deck=3', decks: [animals] },
      )

      expect(nextUrls(calls)).toEqual([
        api('/flashcards/practice/next?deckId=3'),
      ])
      await user.click(screen.getByRole('button', { name: 'Reveal' }))
      await user.click(screen.getByRole('button', { name: 'Got it!' }))

      expect(await screen.findByText('el perro')).toBeInTheDocument()
      expect(calls.find('POST')?.url).toBe(
        api('/flashcards/1/practice-results?deckId=3'),
      )
    })

    it('practices the tag in the URL', async () => {
      const calls = await practice(
        { ...cat, side: 'Spanish' },
        { path: '/practice?tag=4', tags: [pets] },
      )

      expect(nextUrls(calls)).toEqual([
        api('/flashcards/practice/next?tagId=4'),
      ])
      expect(
        screen.getByRole('combobox', { name: 'Practice' }),
      ).toHaveTextContent('Tag: Pets')
    })

    it('practices every card when the deck in the URL is gone', async () => {
      const calls = await practice(
        { ...cat, side: 'Spanish' },
        { path: '/practice?deck=99', decks: [animals] },
      )

      expect(nextUrls(calls)).toEqual([api('/flashcards/practice/next')])
      expect(
        screen.getByRole('combobox', { name: 'Practice' }),
      ).toHaveTextContent('All cards')
    })

    it('links to the decks when the deck has no cards', async () => {
      await practice(null, { path: '/practice?deck=3', decks: [animals] })

      expect(
        screen.getByText('There are no cards in this deck.'),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Edit decks' })).toHaveAttribute(
        'href',
        '/decks',
      )
    })

    it('says so when the tag has no cards', async () => {
      await practice(null, { path: '/practice?tag=4', tags: [pets] })

      expect(
        screen.getByText('There are no cards with this tag.'),
      ).toBeInTheDocument()
    })

    it('says so when the deck runs out of cards during practice', async () => {
      const user = userEvent.setup()
      await practice(
        { ...cat, side: 'Spanish' },
        { path: '/practice?deck=3', decks: [animals], next: null },
      )

      await user.click(screen.getByRole('button', { name: 'Reveal' }))
      await user.click(screen.getByRole('button', { name: 'Got it!' }))

      expect(
        await screen.findByText('There are no cards in this deck.'),
      ).toBeInTheDocument()
    })

    it('leaves out the picker when there are no decks or tags', async () => {
      await practice({ ...cat, side: 'Spanish' })

      expect(
        screen.queryByRole('combobox', { name: 'Practice' }),
      ).not.toBeInTheDocument()
    })
  })

  it('shows an error when loading fails', async () => {
    mockApi({ 'GET /flashcards/practice/next': emptyResponse(500) })
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
