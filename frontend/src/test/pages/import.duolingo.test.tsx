import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackEvent, trackException } from '../../telemetry'
import { clearHandoff, startHandoff } from '../../wordSources/handoff'
import { api, card, deck } from '../support/factories'
import { jsonResponse, mockApi } from '../support/mockApi'
import type { Routes } from '../support/mockApi'
import { renderAt, signInForEachTest } from '../support/render'

signInForEachTest()

// Duolingo's panel on the website tab works like Preply's (see import.preply.test.tsx), with its own bookmarklet,
// deck and words: Duolingo gives a word every English meaning it has, and a meaning goes on the first card that has it.
describe('importing from Duolingo', () => {
  const words = [
    { spanish: 'a', english: ['to', 'at', 'for'] },
    { spanish: 'para', english: ['for', 'in order to'] },
    { spanish: 'por', english: ['for'] },
    { spanish: 'gustaron', english: [] },
    { spanish: 'el pan', english: ['bread'] },
  ]
  // The user already has a card for "el pan".
  const ownCards = [card(1, 'el pan', 'the bread')]
  const duolingoDeck = deck(41, 'Duolingo')

  // This window, opened by the bookmarklet, which is the one that sends it messages. jsdom only takes a real window
  // as a message's source, so that's this one too.
  const opened = Object.assign(new EventTarget(), {
    location: { pathname: '/import', search: '?from=website&site=duolingo' },
    opener: window,
    setTimeout: () => 0,
  }) as unknown as Window

  function sendFromDuolingo(
    data: unknown,
    origin = 'https://www.duolingo.com',
  ) {
    act(() => {
      opened.dispatchEvent(
        new MessageEvent('message', { origin, source: window, data }),
      )
    })
  }

  beforeEach(() => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    startHandoff(opened)
  })

  afterEach(() => {
    clearHandoff()
  })

  // Shows the Import cards page's website tab with Duolingo picked, as the bookmarklet opens it, with the user's
  // cards loaded. Saving anything is answered from routes. The other tabs' lists are empty.
  async function showDuolingo(routes: Routes = {}) {
    const { calls } = mockApi({ 'GET /flashcards': ownCards, ...routes })
    renderAt('/import?from=website&site=duolingo')
    expect(screen.getByRole('tab', { name: 'From a website' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Duolingo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The built-in decks load on their hidden tab too.
    expect(
      await screen.findByText("There aren't any built-in decks yet."),
    ).not.toBeVisible()
    return calls
  }

  // Sends the words and waits for the user's cards to leave out the one they have.
  async function receiveWords() {
    sendFromDuolingo({ type: 'flashcardsage:duolingo-words', words })
    expect(
      await screen.findByText(
        '1 word is left out because you already have a card for it.',
      ),
    ).toBeInTheDocument()
    // The words are listed before the user's cards load, so the one they have collapses away after.
    const list = screen.getByRole('list', { name: 'Cards from Duolingo' })
    await waitFor(() =>
      expect(within(list).queryByText('el pan')).not.toBeInTheDocument(),
    )
    return list
  }

  it('offers its own bookmarklet and deck', async () => {
    const user = userEvent.setup()
    clearHandoff()
    await showDuolingo()

    // Only Duolingo's steps show, though Preply has its own.
    expect(
      screen.getByText(
        'Bring in the words in your Duolingo word list as cards in your Duolingo deck:',
      ),
    ).toBeVisible()
    const steps = within(
      screen.getByRole('region', { name: 'From Duolingo' }),
    ).getAllByRole('listitem')
    expect(
      within(steps[1]).getByRole('heading', { level: 2 }),
    ).toHaveTextContent('Open Duolingo')
    expect(
      within(steps[1]).getByRole('link', { name: 'Duolingo word list' }),
    ).toHaveAttribute('href', 'https://www.duolingo.com/practice-hub/words')
    const bookmarklet = screen.getByRole('link', {
      name: 'Send to FlashCardSage',
    })
    expect(
      decodeURIComponent(bookmarklet.getAttribute('href') ?? ''),
    ).toContain('/import?from=website&site=duolingo')

    // Picking another site shows its steps instead.
    await user.click(screen.getByRole('button', { name: 'Preply' }))

    expect(screen.getByRole('button', { name: 'Preply' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('region', { name: 'From Preply' })).toBeVisible()
    expect(
      screen.queryByRole('region', { name: 'From Duolingo' }),
    ).not.toBeInTheDocument()
  })

  // Such as coming back to the page with the words still here.
  it('opens the website tab on the site whose words are here', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /flashcards': ownCards })
    sendFromDuolingo({ type: 'flashcardsage:duolingo-words', words })
    renderAt('/import')
    expect(
      await screen.findByText("There aren't any built-in decks yet."),
    ).toBeVisible()

    await user.click(screen.getByRole('tab', { name: 'From a website' }))

    expect(screen.getByRole('button', { name: 'Duolingo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      within(screen.getByRole('region', { name: 'From Duolingo' })).getByRole(
        'list',
        { name: 'Cards from Duolingo' },
      ),
    ).toBeVisible()
  })

  it('waits for the words, then lists each as a card with its English', async () => {
    await showDuolingo()
    expect(
      screen.getByText('Getting your words from Duolingo…'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Getting your words from Preply…'),
    ).not.toBeInTheDocument()
    // Words from Preply, or in Preply's message, aren't Duolingo's.
    sendFromDuolingo(
      { type: 'flashcardsage:duolingo-words', words },
      'https://preply.com',
    )
    sendFromDuolingo({ type: 'flashcardsage:preply-words', words })
    expect(
      screen.getByText('Getting your words from Duolingo…'),
    ).toBeInTheDocument()

    const list = await receiveWords()

    expect(
      screen.getByText(
        '1 word is left out because Duolingo has no English for it.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '1 word is left out because its English is on other cards here.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: '2 cards from Duolingo' }),
    ).toBeInTheDocument()
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('a')).toBeInTheDocument()
    expect(within(rows[0]).getByText('to / at / for')).toBeInTheDocument()
    expect(within(rows[1]).getByText('para')).toBeInTheDocument()
    expect(within(rows[1]).getByText('in order to')).toBeInTheDocument()
  })

  it('adds all the cards to a new Duolingo deck', async () => {
    const user = userEvent.setup()
    const calls = await showDuolingo({
      'POST /flashcards/batch': {
        cards: [
          card(9, 'a', ['to', 'at', 'for']),
          card(10, 'para', 'in order to'),
        ],
        skippedCount: 0,
      },
      'POST /decks': jsonResponse(
        { ...duolingoDeck, flashCardIds: [9, 10] },
        201,
      ),
    })
    await receiveWords()

    await user.click(
      screen.getAllByRole('button', { name: 'Add all 2 cards' })[0],
    )

    expect(
      await screen.findByText('Added 2 cards to your Duolingo deck.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open deck' })).toHaveAttribute(
      'href',
      '/decks/41',
    )
    const batch = calls.find('POST', '/flashcards/batch')
    expect(JSON.parse(batch?.init?.body as string)).toEqual({
      cards: [
        { spanish: ['a'], english: ['to', 'at', 'for'], tags: [] },
        { spanish: ['para'], english: ['in order to'], tags: [] },
      ],
      source: 'Duolingo',
    })
    const posted = calls.find('POST', '/decks')
    expect(posted?.url).toBe(api('/decks'))
    expect(JSON.parse(posted?.init?.body as string)).toEqual({
      name: 'Duolingo',
      flashCardIds: [9, 10],
    })
    expect(trackEvent).toHaveBeenCalledWith('DuolingoCardsAdded', {
      count: '2',
    })
    // The words are forgotten once added, and the bookmarklet is offered again.
    expect(
      screen.getByRole('link', { name: 'Send to FlashCardSage' }),
    ).toBeInTheDocument()
  })

  it("says when Duolingo's words can't be read", async () => {
    await showDuolingo()

    sendFromDuolingo({
      type: 'flashcardsage:duolingo-error',
      message: 'Switch to that course on Duolingo.',
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Your words couldn't be read from Duolingo. Switch to that course on Duolingo.",
    )
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'readDuolingo',
    })
  })
})
