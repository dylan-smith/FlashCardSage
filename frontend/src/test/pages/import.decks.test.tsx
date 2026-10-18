import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { unreachableMessage } from '../../api/client'
import type { SystemDeck } from '../../api/systemDecks'
import { trackEvent, trackException } from '../../telemetry'
import { api, card, deck, tag } from '../support/factories'
import { jsonResponse, mockApi, unreachable } from '../support/mockApi'
import type { Routes } from '../support/mockApi'
import {
  renderAt,
  renderLoaded,
  signInForEachTest,
  stubMatchMedia,
} from '../support/render'

signInForEachTest()

describe('importing cards', () => {
  const daysTag = tag(30, 'Days')
  const days: SystemDeck = {
    id: 3,
    name: 'Days of the week',
    cards: [
      card(31, 'lunes', 'Monday', { tags: [daysTag] }),
      card(32, 'martes', 'Tuesday', { tags: [daysTag, tag(33, 'Week')] }),
    ],
    ownedCardIds: [],
  }
  const months: SystemDeck = {
    id: 4,
    name: 'Months',
    cards: [card(41, 'enero', 'January', { tags: [tag(42, 'Months')] })],
    ownedCardIds: [],
  }

  // Shows the Import cards page with these built-in decks, answering anything else from routes.
  async function showImport(
    routes: Routes = {},
    systemDecks: SystemDeck[] = [days, months],
  ) {
    const { calls } = await renderLoaded('/import', {
      'GET /system-decks': systemDecks,
      ...routes,
    })
    return calls
  }

  it('lists the built-in decks with their card counts', async () => {
    await showImport()

    // The built-in decks' tab is open, next to the document's, Preply's and Duolingo's.
    expect(screen.getByRole('tab', { name: 'Built-in decks' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      screen.getByRole('tab', { name: 'From a document' }),
    ).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'From Preply' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(screen.getByRole('tab', { name: 'From Duolingo' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(
      within(
        screen.getByRole('navigation', { name: 'Manage cards' }),
      ).getByRole('link', { name: 'Import cards' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Days of the week')).toBeInTheDocument()
    expect(screen.getByText('2 cards')).toBeInTheDocument()
    expect(screen.getByText('1 card')).toBeInTheDocument()
  })

  // Four tabs spelled out don't fit across a phone. They keep their full names for a screen reader, which is how the
  // other tests find them.
  it('says just where the cards come from on each tab on a phone', async () => {
    await showImport()

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Built-in',
      'Document',
      'Preply',
      'Duolingo',
    ])
  })

  it('spells the tabs out on a wide screen', async () => {
    // A screen at least as wide as the sm breakpoint.
    stubMatchMedia((query) => query.includes('min-width:600px'))
    await showImport()

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Built-in decks',
      'From a document',
      'From Preply',
      'From Duolingo',
    ])
  })

  it("shows and hides a deck's cards", async () => {
    const user = userEvent.setup()
    await showImport()
    // The deck's name shows and hides its cards.
    const toggle = screen.getByRole('button', { name: 'Days of the week' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const cards = screen.getByRole('list', {
      name: 'Cards in "Days of the week"',
    })
    // Laid out like the user's own cards, with their tags, but with nothing to pick.
    const [monday, tuesday] = within(cards).getAllByRole('listitem')
    expect(within(monday).getByText('lunes')).toBeInTheDocument()
    expect(within(monday).getByText('Monday')).toBeInTheDocument()
    expect(within(monday).getByText('Days')).toBeInTheDocument()
    expect(within(tuesday).getByText('martes')).toBeInTheDocument()
    expect(within(tuesday).getByText('Week')).toBeInTheDocument()
    expect(within(cards).queryByRole('checkbox')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => {
      expect(
        screen.queryByRole('list', { name: 'Cards in "Days of the week"' }),
      ).not.toBeInTheDocument()
    })
  })

  it('adds a deck and links to it', async () => {
    const user = userEvent.setup()
    const calls = await showImport({
      'POST /system-decks/3/import': jsonResponse(
        {
          deck: deck(21, 'Days of the week', [5, 6]),
          importedCount: 2,
          skippedCount: 0,
        },
        201,
      ),
    })

    await user.click(
      screen.getByRole('button', { name: 'Add deck "Days of the week"' }),
    )

    expect(
      await screen.findByText('Added Days of the week with 2 cards.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open deck' })).toHaveAttribute(
      'href',
      '/decks/21',
    )
    const post = calls.find('POST')
    expect(post?.url).toBe(api('/system-decks/3/import'))
    expect(trackEvent).toHaveBeenCalledWith('SystemDeckImported')
  })

  it('says how many cards were left out', async () => {
    const user = userEvent.setup()
    await showImport({
      'POST /system-decks/3/import': jsonResponse(
        {
          deck: deck(22, 'Days of the week (2)', [7]),
          importedCount: 1,
          skippedCount: 1,
        },
        201,
      ),
    })

    await user.click(
      screen.getByRole('button', { name: 'Add deck "Days of the week"' }),
    )

    expect(
      await screen.findByText(
        'Added Days of the week (2) with 1 card. 1 card was left out because you already have it.',
      ),
    ).toBeInTheDocument()
  })

  it("shows the API's message when the deck can't be added", async () => {
    const user = userEvent.setup()
    await showImport({
      'POST /system-decks/4/import': jsonResponse(
        { status: 409, detail: 'You already have all of these cards.' },
        409,
      ),
    })

    await user.click(screen.getByRole('button', { name: 'Add deck "Months"' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already have all of these cards.',
    )
    expect(
      screen.queryByRole('link', { name: 'Open deck' }),
    ).not.toBeInTheDocument()
    expect(trackException).not.toHaveBeenCalled()
  })

  it("adds one of a deck's cards and links to its deck", async () => {
    const user = userEvent.setup()
    const calls = await showImport({
      'POST /system-decks/3/cards/32/import': jsonResponse(
        {
          deck: deck(21, 'Days of the week', [5]),
          deckCreated: true,
          card: card(5, 'martes', 'Tuesday'),
        },
        201,
      ),
    })
    await user.click(screen.getByRole('button', { name: 'Days of the week' }))

    await user.click(screen.getByRole('button', { name: 'Add "martes"' }))

    expect(
      await screen.findByText(
        'Added "martes" to a new deck, Days of the week.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open deck' })).toHaveAttribute(
      'href',
      '/decks/21',
    )
    const post = calls.find('POST')
    expect(post?.url).toBe(api('/system-decks/3/cards/32/import'))
    expect(trackEvent).toHaveBeenCalledWith('SystemDeckCardImported')
    // The card's button says it's been added, and the others can still be.
    expect(
      screen.getByRole('button', { name: 'Added "martes"' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add "lunes"' })).toBeEnabled()
  })

  it('shows the cards the user already has as added', async () => {
    const user = userEvent.setup()
    await showImport(undefined, [{ ...days, ownedCardIds: [31] }, months])
    // The deck's card count says how many the user has, and it can still be added for the rest.
    expect(screen.getByText('2 cards, 1 added')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add deck "Days of the week"' }),
    ).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Days of the week' }))

    const added = screen.getByRole('button', { name: 'Added "lunes"' })
    expect(added).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add "martes"' })).toBeEnabled()
    // A disabled button gets no mouse events, so the tooltip is on what's around it, which has it as its title.
    await user.hover(
      screen.getByTitle('This card is already in your collection.'),
    )
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'This card is already in your collection.',
    )
  })

  it('marks the cards of an added deck as added', async () => {
    const user = userEvent.setup()
    let added = false
    mockApi({
      'GET /system-decks': () =>
        jsonResponse(
          added
            ? [{ ...days, ownedCardIds: [31, 32] }, months]
            : [days, months],
        ),
      'POST /system-decks/3/import': () => {
        added = true
        return jsonResponse(
          {
            deck: deck(21, 'Days of the week', [5, 6]),
            importedCount: 2,
            skippedCount: 0,
          },
          201,
        )
      },
    })
    renderAt('/import')
    await user.click(
      await screen.findByRole('button', { name: 'Days of the week' }),
    )

    await user.click(
      screen.getByRole('button', { name: 'Add deck "Days of the week"' }),
    )

    expect(
      await screen.findByRole('button', { name: 'Added "lunes"' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Added "martes"' }),
    ).toBeDisabled()
    // So does the deck, without its cards showing.
    expect(
      screen.getByRole('button', { name: 'Added deck "Days of the week"' }),
    ).toBeDisabled()
    expect(screen.getByText('2 cards, all added')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add deck "Months"' }),
    ).toBeEnabled()
  })

  it('marks a deck as added once its last card is added on its own', async () => {
    const user = userEvent.setup()
    await showImport(
      {
        'POST /system-decks/4/cards/41/import': jsonResponse(
          {
            deck: deck(22, 'Months', [6]),
            deckCreated: true,
            card: card(6, 'enero', 'January'),
          },
          201,
        ),
      },
      [days, months],
    )
    expect(screen.getByText('1 card')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Months' }))

    await user.click(screen.getByRole('button', { name: 'Add "enero"' }))

    expect(
      await screen.findByRole('button', { name: 'Added deck "Months"' }),
    ).toBeDisabled()
    expect(screen.getByText('1 card, all added')).toBeInTheDocument()
  })

  it("says when the user already has a deck's card", async () => {
    const user = userEvent.setup()
    await showImport({
      'POST /system-decks/3/cards/31/import': jsonResponse(
        { status: 409, detail: 'You already have this card.' },
        409,
      ),
    })
    await user.click(screen.getByRole('button', { name: 'Days of the week' }))

    await user.click(screen.getByRole('button', { name: 'Add "lunes"' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already have this card.',
    )
    expect(screen.getByRole('button', { name: 'Add "lunes"' })).toBeEnabled()
    expect(trackException).not.toHaveBeenCalled()
  })

  it("says when the built-in decks can't be loaded", async () => {
    mockApi({
      'GET /system-decks': unreachable,
      'GET /flashcards': unreachable,
    })
    renderAt('/import')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      unreachableMessage,
    )
  })

  it("offers the bookmarklet that brings in Preply words on Preply's tab", async () => {
    const user = userEvent.setup()
    await showImport()
    expect(
      screen.queryByRole('link', { name: 'Send to FlashCardSage' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'From Preply' }))

    expect(screen.getByRole('tab', { name: 'From Preply' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Four steps, in order, with the bookmarklet in the first and Preply's page in the second.
    const steps = within(
      screen.getByRole('tabpanel', { name: 'From Preply' }),
    ).getAllByRole('listitem')
    expect(
      steps.map(
        (step) => within(step).getByRole('heading', { level: 2 }).textContent,
      ),
    ).toEqual([
      'Add the bookmarklet',
      'Open Preply',
      'Click the bookmarklet',
      'Pick and add',
    ])
    const bookmarklet = within(steps[0]).getByRole('link', {
      name: 'Send to FlashCardSage',
    })
    expect(bookmarklet.getAttribute('href')).toMatch(/^javascript:/)
    expect(
      within(steps[1]).getByRole('link', { name: 'Preply vocabulary' }),
    ).toHaveAttribute(
      'href',
      'https://preply.com/en/practice/vocab-bank?subject=spanish',
    )

    // It only works as a bookmark, so clicking it here says how to use it.
    await user.click(bookmarklet)

    expect(
      screen.getByText(/This button only works from your bookmarks bar\./),
    ).toBeInTheDocument()
  })
})
