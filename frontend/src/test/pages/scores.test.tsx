import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { unreachableMessage } from '../../api/client'
import { trackException } from '../../telemetry'
import { api, deck, pets } from '../support/factories'
import {
  emptyResponse,
  jsonResponse,
  mockApi,
  unreachable,
} from '../support/mockApi'
import type { Call, CallLog } from '../support/mockApi'
import { renderAt, signInForEachTest } from '../support/render'

signInForEachTest()

// The practice details of a card that's never been practiced.
const neverPracticed = {
  gotIt: 0,
  wasClose: 0,
  failed: 0,
  lastPracticedAt: null,
}

describe('scores', () => {
  // The urls the page asked for its scores from, in order.
  function scoresUrls(calls: CallLog) {
    return calls.filter('GET', '/flashcards/scores').map((call) => call.url)
  }

  it('shows the total and each card with its score, in the order given', async () => {
    const { calls } = mockApi({
      'GET /flashcards/scores': {
        total: 130,
        maximum: 300,
        cards: [
          {
            id: 3,
            spanish: ['la casa'],
            english: ['the house'],
            score: 0,
            ...neverPracticed,
          },
          {
            id: 2,
            spanish: ['el perro'],
            english: ['the dog'],
            score: 50,
            ...neverPracticed,
          },
          {
            id: 1,
            spanish: ['el gato'],
            english: ['the cat'],
            score: 80,
            ...neverPracticed,
          },
        ],
      },
    })
    renderAt('/scores')

    expect(
      await screen.findByText('Total score 130 / 300 (43%)'),
    ).toBeInTheDocument()
    const items = within(
      screen.getByRole('list', { name: 'Card scores' }),
    ).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'la casathe houseNever practiced0 / 100',
      'el perrothe dogNever practiced50 / 100',
      'el gatothe catNever practiced80 / 100',
    ])
    expect(screen.getByText('la casa')).toHaveAttribute('lang', 'es')
    expect(scoresUrls(calls)).toEqual([api('/flashcards/scores')])
  })

  it('shows how many times each card was practiced, how each went and when it was last', async () => {
    const lastPracticedAt = '2026-10-18T14:32:00Z'
    mockApi({
      'GET /flashcards/scores': {
        total: 50,
        maximum: 300,
        cards: [
          {
            id: 3,
            spanish: ['la casa'],
            english: ['the house'],
            score: 0,
            ...neverPracticed,
          },
          {
            id: 2,
            spanish: ['el perro'],
            english: ['the dog'],
            score: 0,
            gotIt: 2,
            wasClose: 1,
            failed: 1,
            lastPracticedAt,
          },
          {
            id: 1,
            spanish: ['el gato'],
            english: ['the cat'],
            score: 50,
            gotIt: 1,
            wasClose: 0,
            failed: 0,
            lastPracticedAt,
          },
        ],
      },
    })
    renderAt('/scores')

    await screen.findByText('Total score 50 / 300 (17%)')
    const last = new Date(lastPracticedAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    const items = within(
      screen.getByRole('list', { name: 'Card scores' }),
    ).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'la casathe houseNever practiced0 / 100',
      `el perrothe dogPracticed 4 times: 2 got it, 1 close, 1 failedLast ${last}0 / 100`,
      `el gatothe catPracticed 1 time: 1 got it, 0 close, 0 failedLast ${last}50 / 100`,
    ])
  })

  it('shades each card from red for a low score to green for a high one', async () => {
    mockApi({
      'GET /flashcards/scores': {
        total: 150,
        maximum: 300,
        cards: [
          {
            id: 3,
            spanish: ['la casa'],
            english: ['the house'],
            score: 0,
            ...neverPracticed,
          },
          {
            id: 2,
            spanish: ['el perro'],
            english: ['the dog'],
            score: 50,
            ...neverPracticed,
          },
          {
            id: 1,
            spanish: ['el gato'],
            english: ['the cat'],
            score: 100,
            ...neverPracticed,
          },
        ],
      },
    })
    renderAt('/scores')

    await screen.findByText('Total score 150 / 300 (50%)')
    const items = within(
      screen.getByRole('list', { name: 'Card scores' }),
    ).getAllByRole('listitem')
    expect(items[0]).toHaveStyle({ backgroundColor: 'hsl(0, 70%, 90%)' })
    expect(items[1]).toHaveStyle({ backgroundColor: 'hsl(60, 70%, 90%)' })
    expect(items[2]).toHaveStyle({ backgroundColor: 'hsl(120, 70%, 90%)' })
  })

  it('finds cards by either side, whatever their accents and case, keeping the total', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /flashcards/scores': {
        total: 130,
        maximum: 300,
        cards: [
          {
            id: 3,
            spanish: ['la canción'],
            english: ['the song'],
            score: 0,
            ...neverPracticed,
          },
          {
            id: 2,
            spanish: ['el perro'],
            english: ['the dog'],
            score: 50,
            ...neverPracticed,
          },
          {
            id: 1,
            spanish: ['el gato'],
            english: ['the cat'],
            score: 80,
            ...neverPracticed,
          },
        ],
      },
    })
    renderAt('/scores')
    await screen.findByText('Total score 130 / 300 (43%)')

    await user.type(
      screen.getByRole('searchbox', { name: 'Search' }),
      'CANCION',
    )

    const items = () =>
      within(screen.getByRole('list', { name: 'Card scores' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    expect(items()).toEqual(['la canciónthe songNever practiced0 / 100'])
    expect(screen.getByText('Total score 130 / 300 (43%)')).toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: 'Search' }))
    await user.type(
      screen.getByRole('searchbox', { name: 'Search' }),
      'the dog',
    )

    expect(items()).toEqual(['el perrothe dogNever practiced50 / 100'])

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'x')

    expect(screen.getByText('No cards match.')).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Card scores' }),
    ).not.toBeInTheDocument()
  })

  describe('picking which cards to score', () => {
    const animals = deck(3, 'Animals', [1])
    const scoredCat = { id: 1, spanish: ['el gato'], english: ['the cat'] }
    const house = { id: 2, spanish: ['la casa'], english: ['the house'] }

    // Every card scores 0 and 50 for the house and the cat, or just the cat's 50 for a deck or tag.
    function mockScores() {
      return mockApi({
        'GET /tags': [pets],
        'GET /decks': [animals],
        'GET /flashcards/scores': (call: Call) =>
          jsonResponse(
            call.path.includes('?')
              ? {
                  total: 50,
                  maximum: 100,
                  cards: [{ ...scoredCat, score: 50, ...neverPracticed }],
                }
              : {
                  total: 50,
                  maximum: 200,
                  cards: [
                    { ...house, score: 0, ...neverPracticed },
                    { ...scoredCat, score: 50, ...neverPracticed },
                  ],
                },
          ),
      }).calls
    }

    function items() {
      return within(screen.getByRole('list', { name: 'Card scores' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    }

    it('offers every card, the decks and the tags, and scores and totals just the one picked', async () => {
      const user = userEvent.setup()
      const calls = mockScores()
      renderAt('/scores')
      await screen.findByText('Total score 50 / 200 (25%)')

      await user.click(screen.getByRole('combobox', { name: 'Cards' }))
      const listbox = screen.getByRole('listbox')
      expect(
        within(listbox)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['All cards', 'Deck: Animals', 'Tag: Pets'])
      await user.click(
        within(listbox).getByRole('option', { name: 'Deck: Animals' }),
      )

      expect(
        await screen.findByText('Total score 50 / 100 (50%)'),
      ).toBeInTheDocument()
      expect(items()).toEqual(['el gatothe catNever practiced50 / 100'])
      expect(scoresUrls(calls)).toEqual([
        api('/flashcards/scores'),
        api('/flashcards/scores?deckId=3'),
      ])
      expect(screen.getByRole('combobox', { name: 'Cards' })).toHaveTextContent(
        'Deck: Animals',
      )
    })

    it('scores the tag in the URL', async () => {
      const calls = mockScores()
      renderAt('/scores?tag=4')

      expect(
        await screen.findByText('Total score 50 / 100 (50%)'),
      ).toBeInTheDocument()
      expect(scoresUrls(calls)).toEqual([api('/flashcards/scores?tagId=4')])
      expect(screen.getByRole('combobox', { name: 'Cards' })).toHaveTextContent(
        'Tag: Pets',
      )
    })

    it('keeps the search when another deck or tag is picked', async () => {
      const user = userEvent.setup()
      mockScores()
      renderAt('/scores')
      await screen.findByText('Total score 50 / 200 (25%)')
      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'gato')

      await user.click(screen.getByRole('combobox', { name: 'Cards' }))
      await user.click(screen.getByRole('option', { name: 'Tag: Pets' }))

      await screen.findByText('Total score 50 / 100 (50%)')
      expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue(
        'gato',
      )
      expect(items()).toEqual(['el gatothe catNever practiced50 / 100'])
    })

    it('links to the decks when the deck has no cards', async () => {
      mockApi({
        'GET /decks': [animals],
        'GET /flashcards/scores': { total: 0, maximum: 0, cards: [] },
      })
      renderAt('/scores?deck=3')

      expect(
        await screen.findByText('There are no cards in this deck.'),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Edit decks' })).toHaveAttribute(
        'href',
        '/decks',
      )
      expect(
        screen.getByRole('combobox', { name: 'Cards' }),
      ).toBeInTheDocument()
    })

    it('leaves out the picker when there are no decks or tags', async () => {
      mockApi({
        'GET /flashcards/scores': {
          total: 0,
          maximum: 100,
          cards: [{ ...scoredCat, score: 0, ...neverPracticed }],
        },
      })
      renderAt('/scores')
      await screen.findByText('Total score 0 / 100 (0%)')

      expect(
        screen.queryByRole('combobox', { name: 'Cards' }),
      ).not.toBeInTheDocument()
    })
  })

  it('links to adding cards when there are none', async () => {
    mockApi({ 'GET /flashcards/scores': { total: 0, maximum: 0, cards: [] } })
    renderAt('/scores')

    expect(
      await screen.findByText('There are no flash cards to score yet.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Add flash cards' }),
    ).toHaveAttribute('href', '/')
  })

  it('shows an error when loading fails', async () => {
    mockApi({ 'GET /flashcards/scores': emptyResponse(500) })
    renderAt('/scores')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to load scores.',
    )
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'scores',
    })
  })

  it('says to try again when the API is unreachable', async () => {
    mockApi({ 'GET /flashcards/scores': unreachable })
    renderAt('/scores')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      unreachableMessage,
    )
  })
})
