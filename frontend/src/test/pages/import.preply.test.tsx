import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deck } from '../../api/decks'
import { touchOnlyQuery } from '../../components/import/BookmarkletSteps'
import { trackEvent, trackException } from '../../telemetry'
import { clearHandoff, startHandoff } from '../../wordSources/handoff'
import { api, card, deck } from '../support/factories'
import { jsonResponse, mockApi } from '../support/mockApi'
import type { Routes } from '../support/mockApi'
import { renderAt, signInForEachTest, stubMatchMedia } from '../support/render'

signInForEachTest()

describe('importing from Preply', () => {
  const words = [
    { spanish: 'tostado', english: 'toasted', partOfSpeech: 'adjective' },
    { spanish: 'avena', english: 'oatmeal', partOfSpeech: 'noun' },
    { spanish: 'gustaron', english: null, partOfSpeech: null },
    { spanish: 'picante', english: 'spicy', partOfSpeech: null },
    { spanish: 'el pan', english: 'bread', partOfSpeech: 'noun' },
  ]
  // The user already has a card for "el pan", whatever its case.
  const ownCards = [card(1, 'El Pan', 'the bread')]
  const preplyDeck = deck(40, 'Preply')

  // This window, opened by the bookmarklet, which is the one that sends it messages. jsdom only takes a real window
  // as a message's source, so that's this one too.
  // Ends the wait for the words, as its time limit does, which a test calls when it wants it to.
  let endWait: () => void = () => {}
  const opened = Object.assign(new EventTarget(), {
    location: { pathname: '/import', search: '?from=preply' },
    opener: window,
    setTimeout: (handler: () => void) => {
      endWait = handler
      return 0
    },
  }) as unknown as Window

  function sendFromPreply(data: unknown, origin = 'https://preply.com') {
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

  // Shows the Import cards page's Preply tab, as the bookmarklet opens it, with the user's cards and decks loaded.
  // Saving anything is answered from routes. The other tabs' lists are empty.
  async function showPreply(routes: Routes = {}, decks: Deck[] = []) {
    const { calls } = mockApi({
      'GET /flashcards': ownCards,
      'GET /decks': decks,
      ...routes,
    })
    renderAt('/import?from=preply')
    expect(screen.getByRole('tab', { name: 'From Preply' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // The built-in decks load on their hidden tab too.
    expect(
      await screen.findByText("There aren't any built-in decks yet."),
    ).not.toBeVisible()
    return calls
  }

  // Sends the words and waits for the user's cards to leave out the ones they have.
  async function receiveWords() {
    sendFromPreply({ type: 'flashcardsage:preply-words', words })
    expect(
      await screen.findByText(
        '1 word is left out because you already have a card for it.',
      ),
    ).toBeInTheDocument()
    // The words are listed before the user's cards load, so the one they have collapses away after.
    const list = screen.getByRole('list', { name: 'Cards from Preply' })
    await waitFor(() =>
      expect(within(list).queryByText('el pan')).not.toBeInTheDocument(),
    )
    return list
  }

  it('waits for the words, then lists them like cards to add', async () => {
    await showPreply()

    expect(
      screen.getByText('Getting your words from Preply…'),
    ).toBeInTheDocument()
    // Anything not from Preply is ignored.
    sendFromPreply(
      { type: 'flashcardsage:preply-words', words },
      'https://evil.example',
    )
    expect(
      screen.getByText('Getting your words from Preply…'),
    ).toBeInTheDocument()

    const list = await receiveWords()

    expect(
      screen.getByRole('heading', { level: 2, name: '3 cards from Preply' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '1 word is left out because Preply has no English for it.',
      ),
    ).toBeInTheDocument()
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('tostado')).toBeInTheDocument()
    expect(within(rows[0]).getByText('toasted')).toBeInTheDocument()
    // Each can be added, changed or removed, as on the document's tab.
    for (const name of ['Add', 'Edit', 'Remove']) {
      expect(
        within(rows[0]).getByRole('button', { name: `${name} "tostado"` }),
      ).toBeInTheDocument()
    }
    // Above and below the list, so a long one can be added from either end.
    const addAll = screen.getAllByRole('button', { name: 'Add all 3 cards' })
    expect(addAll).toHaveLength(2)
    expect(
      addAll[0].compareDocumentPosition(list) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      addAll[1].compareDocumentPosition(list) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()
  })

  // The words are kept until they're all added or removed, but what was left out is only said the first time.
  it("doesn't say again which words are left out after coming back", async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /flashcards': ownCards })
    const { unmount } = renderAt('/import?from=preply')
    await receiveWords()
    unmount()

    renderAt('/import')
    expect(
      await screen.findByText("There aren't any built-in decks yet."),
    ).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'From Preply' }))

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '3 cards from Preply',
      }),
    ).toBeVisible()
    expect(screen.queryByText(/ left out because /)).not.toBeInTheDocument()
  })

  it('waits for the Preply tab to say which words are left out', async () => {
    mockApi({ 'GET /flashcards': ownCards })
    sendFromPreply({ type: 'flashcardsage:preply-words', words })
    const user = userEvent.setup()
    renderAt('/import')
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '3 cards from Preply',
        hidden: true,
      }),
    ).not.toBeVisible()
    expect(screen.queryByText(/ left out because /)).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'From Preply' }))

    expect(
      await screen.findByText(
        '1 word is left out because you already have a card for it.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '1 word is left out because Preply has no English for it.',
      ),
    ).toBeInTheDocument()
  })

  it('adds one card to a new Preply deck', async () => {
    const user = userEvent.setup()
    const calls = await showPreply({
      'POST /flashcards': jsonResponse(card(8, 'avena', 'oatmeal'), 201),
      'POST /decks': jsonResponse({ ...preplyDeck, flashCardIds: [8] }, 201),
    })
    const list = await receiveWords()

    await user.click(within(list).getByRole('button', { name: 'Add "avena"' }))

    expect(
      await screen.findByText('Added “avena” to your Preply deck.'),
    ).toBeInTheDocument()
    expect(
      within(list).queryByRole('button', { name: 'Add "avena"' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Add all 2 cards' }),
    ).toHaveLength(2)
    const posts = calls.filter('POST')
    expect(posts.map((call) => call.url)).toEqual([
      api('/flashcards'),
      api('/decks'),
    ])
    expect(JSON.parse(posts[0].init?.body as string)).toEqual({
      spanish: ['avena'],
      english: ['oatmeal'],
      tags: [],
    })
    expect(JSON.parse(posts[1].init?.body as string)).toEqual({
      name: 'Preply',
      flashCardIds: [8],
    })
    expect(trackEvent).toHaveBeenCalledWith('PreplyCardAdded')
  })

  // A user can't have two cards with the same English, so Preply's tostado and tostada are one card.
  it('puts Preply words with the same English on one card', async () => {
    const user = userEvent.setup()
    const calls = await showPreply({
      'POST /flashcards/batch': {
        cards: [
          {
            id: 9,
            spanish: ['tostado', 'tostada'],
            english: ['toasted'],
            tags: [],
            imageUrl: null,
          },
        ],
        skippedCount: 0,
      },
      'POST /decks': jsonResponse({ ...preplyDeck, flashCardIds: [9] }, 201),
    })

    sendFromPreply({
      type: 'flashcardsage:preply-words',
      words: [
        { spanish: 'tostado', english: 'toasted', partOfSpeech: null },
        { spanish: 'tostada', english: 'toasted', partOfSpeech: null },
      ],
    })

    const list = await screen.findByRole('list', {
      name: 'Cards from Preply',
    })
    const [card] = within(list).getAllByRole('listitem')
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(card).getByText('tostado / tostada')).toBeInTheDocument()
    expect(within(card).getByText('toasted')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Add 1 card' })[0])

    expect(
      await screen.findByText(/^Added 1 card to your Preply deck\./),
    ).toBeInTheDocument()
    const batch = calls.find('POST', '/flashcards/batch')
    expect(JSON.parse(batch?.init?.body as string)).toEqual({
      cards: [
        { spanish: ['tostado', 'tostada'], english: ['toasted'], tags: [] },
      ],
    })
  })

  it('adds all the cards left to the Preply deck the user has', async () => {
    const user = userEvent.setup()
    const calls = await showPreply(
      {
        'POST /flashcards/batch': {
          cards: [card(9, 'tostado', 'toasted')],
          skippedCount: 1,
        },
        'PATCH /decks/40/cards': { ...preplyDeck, flashCardIds: [5, 9] },
      },
      [{ ...preplyDeck, name: 'preply', flashCardIds: [5] }],
    )
    const list = await receiveWords()

    await user.click(
      within(list).getByRole('button', { name: 'Remove "avena"' }),
    )
    // The one at the bottom.
    await user.click(
      screen.getAllByRole('button', { name: 'Add all 2 cards' })[1],
    )

    expect(
      await screen.findByText(
        'Added 1 card to your Preply deck. 1 card was left out because you already have it.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open deck' })).toHaveAttribute(
      'href',
      '/decks/40',
    )
    const batch = calls.find('POST', '/flashcards/batch')
    expect(JSON.parse(batch?.init?.body as string)).toEqual({
      cards: [
        { spanish: ['tostado'], english: ['toasted'], tags: [] },
        { spanish: ['picante'], english: ['spicy'], tags: [] },
      ],
    })
    // The cards go in the deck the user already has, whatever its case.
    const patch = calls.find('PATCH')
    expect(patch?.url).toBe(api('/decks/40/cards'))
    expect(JSON.parse(patch?.init?.body as string)).toEqual({
      add: [9],
      remove: [],
    })
    expect(trackEvent).toHaveBeenCalledWith('PreplyCardsAdded', {
      count: '1',
    })
    // The words are forgotten once added, and the bookmarklet is offered again.
    expect(
      screen.queryByRole('list', { name: 'Cards from Preply' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Send to FlashCardSage' }),
    ).toBeInTheDocument()
  })

  it("says when a card can't be added, and keeps it to try again", async () => {
    const user = userEvent.setup()
    await showPreply({
      'POST /flashcards': jsonResponse(
        {
          status: 409,
          detail: 'You already have a flash card with that word.',
        },
        409,
      ),
    })
    const list = await receiveWords()

    await user.click(
      within(list).getByRole('button', { name: 'Add "tostado"' }),
    )

    expect(
      await screen.findByText('You already have a flash card with that word.'),
    ).toBeInTheDocument()
    expect(trackException).not.toHaveBeenCalled()
    expect(
      within(list).getByRole('button', { name: 'Add "tostado"' }),
    ).toBeInTheDocument()
  })

  it("says when Preply's words can't be read", async () => {
    await showPreply()

    sendFromPreply({
      type: 'flashcardsage:preply-error',
      message: 'Not signed in',
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Your words couldn't be read from Preply. Not signed in",
    )
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'readPreply',
    })
    expect(
      screen.getByRole('link', { name: 'Send to FlashCardSage' }),
    ).toBeInTheDocument()
  })

  it('offers the steps again when no words come', async () => {
    await showPreply()
    expect(
      screen.getByText('Getting your words from Preply…'),
    ).toBeInTheDocument()

    act(() => endWait())

    expect(screen.getByText(/No words came from Preply\./)).toBeInTheDocument()
    expect(
      screen.queryByText('Getting your words from Preply…'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Send to FlashCardSage' }),
    ).toBeInTheDocument()
  })

  it('stops waiting for the words when asked to', async () => {
    const user = userEvent.setup()
    await showPreply()

    await user.click(screen.getByRole('button', { name: 'Stop waiting' }))

    expect(
      screen.queryByText('Getting your words from Preply…'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Send to FlashCardSage' }),
    ).toBeInTheDocument()
  })

  it('says how to use the bookmarklet when opened some other way', async () => {
    clearHandoff()
    await showPreply()

    expect(
      screen.getByRole('link', { name: 'Send to FlashCardSage' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Getting your words from Preply…'),
    ).not.toBeInTheDocument()
  })

  it('tells phone users to bring in their words on a computer', async () => {
    // A touch screen with no mouse, as a phone has.
    stubMatchMedia((query) => query === touchOnlyQuery)
    clearHandoff()
    await showPreply()

    expect(
      screen.getByText(/Bringing in your Preply words needs a computer\./),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Send to FlashCardSage' }),
    ).not.toBeInTheDocument()
  })
})
