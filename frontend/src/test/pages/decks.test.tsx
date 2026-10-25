import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Deck } from '../../api/decks'
import { unreachableMessage } from '../../api/client'
import type { FlashCard } from '../../api/flashCards'
import { trackEvent, trackException } from '../../telemetry'
import { api, card, cat, deck, dog, pets } from '../support/factories'
import {
  emptyResponse,
  jsonResponse,
  mockApi,
  unreachable,
} from '../support/mockApi'
import type { Routes } from '../support/mockApi'
import {
  clickDelete,
  renderAt,
  signInForEachTest,
  waitForLoaded,
} from '../support/render'

signInForEachTest()

describe('decks', () => {
  const petCat = { ...cat, tags: [pets] }
  const petDog = { ...dog, tags: [pets] }
  const house = card(3, 'la casa', 'the house')
  const song = card(4, 'la canción', 'the song')
  const cards = [petCat, petDog, house, song]
  const animals = deck(7, 'Animals', [1, 2])

  // Answers loading the cards and a deck, and every change from routes.
  function mockDeckApi(
    shown: Deck | null,
    routes: Routes = {},
    allCards: FlashCard[] = cards,
  ) {
    return mockApi({
      'GET /flashcards': allCards,
      'GET /tags': [pets],
      'GET /decks': shown === null ? [] : [shown],
      'GET /decks/:id': shown ?? emptyResponse(404),
      ...routes,
    }).calls
  }

  async function showPage(path: string) {
    renderAt(path)
    await waitForLoaded()
  }

  // The card checkboxes in the tab shown, by their Spanish.
  function cardBox(spanish: string) {
    return screen.getByRole('checkbox', { name: `Pick "${spanish}"` })
  }

  describe('the list', () => {
    it('lists the decks with how many cards each has', async () => {
      mockApi({ 'GET /decks': [animals, deck(8, 'Home', [3])] })
      await showPage('/decks')

      const items = within(screen.getByRole('list')).getAllByRole('listitem')
      expect(items.map((item) => item.textContent)).toEqual([
        expect.stringContaining('Animals2 cards'),
        expect.stringContaining('Home1 card'),
      ])
      expect(screen.getByRole('link', { name: 'Animals' })).toHaveAttribute(
        'href',
        '/decks/7',
      )
      expect(
        screen.getByRole('link', { name: 'Practice deck "Animals"' }),
      ).toHaveAttribute('href', '/practice?deck=7')
    })

    it('says when there are no decks yet', async () => {
      mockApi()
      await showPage('/decks')

      expect(
        screen.getByText("You haven't made any decks yet."),
      ).toBeInTheDocument()
    })

    it('creates a deck and opens it on adding cards', async () => {
      const user = userEvent.setup()
      const created = deck(9, 'Week 1')
      const calls = mockDeckApi(created, {
        'POST /decks': jsonResponse(created, 201),
      })
      await showPage('/decks')

      await user.type(
        screen.getByLabelText('Deck name', { exact: false }),
        ' Week 1 ',
      )
      await user.click(screen.getByRole('button', { name: 'Create deck' }))

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Week 1' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('tab', { name: 'Add cards (4)' }),
      ).toHaveAttribute('aria-selected', 'true')
      const post = calls.find('POST')
      expect(post?.url).toBe(api('/decks'))
      expect(post?.init?.body).toBe(
        JSON.stringify({ name: 'Week 1', flashCardIds: [] }),
      )
      expect(trackEvent).toHaveBeenCalledWith('DeckCreated')
    })

    it('shows why the API refused a deck', async () => {
      const user = userEvent.setup()
      mockDeckApi(animals, {
        'POST /decks': jsonResponse(
          { errors: { Name: ["There's already a deck with that name."] } },
          400,
        ),
      })
      await showPage('/decks')

      await user.type(
        screen.getByLabelText('Deck name', { exact: false }),
        'animals',
      )
      await user.click(screen.getByRole('button', { name: 'Create deck' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "There's already a deck with that name.",
      )
      expect(screen.getByLabelText('Deck name', { exact: false })).toHaveValue(
        'animals',
      )
      expect(trackException).not.toHaveBeenCalled()
    })

    it('deletes a deck', async () => {
      const user = userEvent.setup()
      const calls = mockDeckApi(animals, {
        'DELETE /decks/7': emptyResponse(204),
      })
      await showPage('/decks')

      await clickDelete(user, 'Delete deck "Animals"', 'Delete deck "Animals"?')

      expect(
        await screen.findByText("You haven't made any decks yet."),
      ).toBeInTheDocument()
      const del = calls.find('DELETE')
      expect(del?.url).toBe(api('/decks/7'))
      expect(trackEvent).toHaveBeenCalledWith('DeckDeleted')
    })

    it('shows an error when loading fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(unreachable)
      renderAt('/decks')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        unreachableMessage,
      )
    })
  })

  describe("a deck's page", () => {
    it("shows the deck's cards, with the rest to add on the other tab", async () => {
      const user = userEvent.setup()
      mockDeckApi(animals)
      await showPage('/decks/7')

      expect(
        screen.getByRole('heading', { level: 2, name: 'Animals' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Practice deck "Animals"' }),
      ).toHaveAttribute('href', '/practice?deck=7')
      // Decks stays marked on a deck's page.
      expect(
        within(
          screen.getByRole('navigation', { name: 'Manage cards' }),
        ).getByRole('link', { name: /^Decks/ }),
      ).toHaveAttribute('aria-current', 'page')
      expect(
        screen.getByRole('tab', { name: 'In this deck (2)' }),
      ).toHaveAttribute('aria-selected', 'true')
      expect(cardBox('el gato')).toBeInTheDocument()
      expect(cardBox('el perro')).toBeInTheDocument()
      expect(
        screen.queryByRole('checkbox', { name: 'Pick "la casa"' }),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Add cards (2)' }))

      expect(cardBox('la casa')).toBeInTheDocument()
      expect(cardBox('la canción')).toBeInTheDocument()
      expect(
        screen.queryByRole('checkbox', { name: 'Pick "el gato"' }),
      ).not.toBeInTheDocument()
    })

    it("shows the cards' pictures on both tabs", async () => {
      const user = userEvent.setup()
      mockDeckApi(animals, undefined, [
        { ...petCat, imageUrl: 'http://images.test/1.png' },
        petDog,
        { ...house, imageUrl: 'http://images.test/3.png' },
        song,
      ])
      await showPage('/decks/7')

      expect(
        screen.getByRole('img', { name: 'Picture for "el gato"' }),
      ).toHaveAttribute('src', 'http://images.test/1.png')
      expect(
        screen.queryByRole('img', { name: 'Picture for "el perro"' }),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Add cards (2)' }))

      expect(
        screen.getByRole('img', { name: 'Picture for "la casa"' }),
      ).toHaveAttribute('src', 'http://images.test/3.png')
    })

    it('finds cards by either side, whatever their accents and case', async () => {
      const user = userEvent.setup()
      mockDeckApi({ ...animals, flashCardIds: [] })
      await showPage('/decks/7')

      await user.type(
        screen.getByRole('searchbox', { name: 'Search' }),
        'CANCION',
      )

      expect(cardBox('la canción')).toBeInTheDocument()
      expect(screen.getAllByRole('checkbox', { name: /^Pick "/ })).toHaveLength(
        1,
      )

      await user.clear(screen.getByRole('searchbox', { name: 'Search' }))
      await user.type(
        screen.getByRole('searchbox', { name: 'Search' }),
        'the dog',
      )

      expect(screen.getAllByRole('checkbox', { name: /^Pick "/ })).toHaveLength(
        1,
      )
      expect(cardBox('el perro')).toBeInTheDocument()
    })

    it('adds every card with a tag, and stays on adding cards', async () => {
      const user = userEvent.setup()
      const calls = mockDeckApi(
        { ...animals, flashCardIds: [3] },
        { 'PATCH /decks/7/cards': { ...animals, flashCardIds: [1, 2, 3] } },
      )
      await showPage('/decks/7')
      await user.click(screen.getByRole('tab', { name: 'Add cards (3)' }))

      await user.click(
        within(
          screen.getByRole('group', { name: 'Show cards tagged' }),
        ).getByRole('button', { name: 'Pets (2)' }),
      )
      await user.click(screen.getByRole('checkbox', { name: 'Pick all 2' }))
      await user.click(screen.getByRole('button', { name: 'Add 2 cards' }))

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Added 2 cards to the deck.',
      )
      const patch = calls.find('PATCH')
      expect(patch?.url).toBe(api('/decks/7/cards'))
      expect(patch?.init?.body).toBe(
        JSON.stringify({ add: [1, 2], remove: [] }),
      )
      expect(screen.getByText('3 cards')).toBeInTheDocument()
      expect(
        screen.getByRole('tab', { name: 'Add cards (1)' }),
      ).toHaveAttribute('aria-selected', 'true')
      expect(
        screen.getByRole('tab', { name: 'In this deck (3)' }),
      ).toBeInTheDocument()
      expect(trackEvent).toHaveBeenCalledWith('DeckCardsAdded')
    })

    it('removes the cards picked', async () => {
      const user = userEvent.setup()
      const calls = mockDeckApi(animals, {
        'PATCH /decks/7/cards': { ...animals, flashCardIds: [2] },
      })
      await showPage('/decks/7')

      expect(
        screen.getByRole('button', { name: 'Remove cards from deck' }),
      ).toBeDisabled()
      await user.click(cardBox('el gato'))
      await user.click(
        screen.getByRole('button', { name: 'Remove 1 card from deck' }),
      )

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Removed 1 card from the deck.',
      )
      const patch = calls.find('PATCH')
      expect(patch?.init?.body).toBe(JSON.stringify({ add: [], remove: [1] }))
      expect(
        screen.getByRole('tab', { name: 'In this deck (1)' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('checkbox', { name: 'Pick "el gato"' }),
      ).not.toBeInTheDocument()
    })

    it('deletes a card, not just from the deck', async () => {
      const user = userEvent.setup()
      const calls = mockDeckApi(animals, {
        'POST /flashcards/delete': emptyResponse(204),
      })
      await showPage('/decks/7')

      await clickDelete(user, 'Delete "el gato"', 'Delete "el gato"?')

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Deleted 1 card.',
      )
      const post = calls.find('POST')
      expect(post?.url).toBe(api('/flashcards/delete'))
      expect(post?.init?.body).toBe(JSON.stringify({ flashCardIds: [1] }))
      expect(calls.some('PATCH')).toBe(false)
      expect(screen.getByText('1 card')).toBeInTheDocument()
      expect(
        screen.getByRole('tab', { name: 'In this deck (1)' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('checkbox', { name: 'Pick "el gato"' }),
      ).not.toBeInTheDocument()
      // It's gone, so it isn't one to add back either.
      expect(
        screen.getByRole('tab', { name: 'Add cards (2)' }),
      ).toBeInTheDocument()
      expect(trackEvent).toHaveBeenCalledWith('FlashCardsDeleted')
    })

    it('removes a card from the deck with its own button, keeping the card', async () => {
      const user = userEvent.setup()
      const calls = mockDeckApi(animals, {
        'PATCH /decks/7/cards': { ...animals, flashCardIds: [2] },
      })
      await showPage('/decks/7')

      await user.click(
        screen.getByRole('button', {
          name: 'Remove from deck "el gato"',
        }),
      )

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Removed 1 card from the deck.',
      )
      const patch = calls.find('PATCH')
      expect(patch?.init?.body).toBe(JSON.stringify({ add: [], remove: [1] }))
      expect(calls.some('POST')).toBe(false)
      // It's still a card, so it can be added back.
      expect(
        screen.getByRole('tab', { name: 'Add cards (3)' }),
      ).toBeInTheDocument()
    })

    it('deletes the cards picked once the user says so', async () => {
      const user = userEvent.setup()
      const calls = mockDeckApi(animals, {
        'POST /flashcards/delete': emptyResponse(204),
      })
      await showPage('/decks/7')

      expect(screen.getByRole('button', { name: 'Delete…' })).toBeDisabled()
      await user.click(screen.getByRole('checkbox', { name: 'Pick all 2' }))
      await user.click(screen.getByRole('button', { name: 'Delete 2 cards…' }))
      await user.click(
        within(
          await screen.findByRole('dialog', { name: 'Delete 2 cards?' }),
        ).getByRole('button', { name: 'Delete' }),
      )

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Deleted 2 cards.',
      )
      const post = calls.find('POST')
      expect(post?.init?.body).toBe(JSON.stringify({ flashCardIds: [1, 2] }))
      expect(
        screen.getByRole('tab', { name: 'In this deck (0)' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('tab', { name: 'Add cards (2)' }),
      ).toBeInTheDocument()
    })

    it('edits a card that is not in the deck yet', async () => {
      const user = userEvent.setup()
      const calls = mockDeckApi(animals, {
        'PUT /flashcards/3': { ...house, spanish: ['la casita'] },
      })
      await showPage('/decks/7')
      await user.click(screen.getByRole('tab', { name: 'Add cards (2)' }))

      await user.click(screen.getByRole('button', { name: 'Edit "la casa"' }))
      const spanish = screen.getByLabelText('Spanish')
      expect(spanish).toHaveValue('la casa')
      await user.clear(spanish)
      await user.type(spanish, 'la casita')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('la casita')).toBeInTheDocument()
      const put = calls.find('PUT')
      expect(put?.url).toBe(api('/flashcards/3'))
      // Editing it doesn't put it in the deck.
      expect(calls.some('PATCH')).toBe(false)
      expect(
        screen.getByRole('tab', { name: 'Add cards (2)' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'Remove from deck "la casita"',
        }),
      ).not.toBeInTheDocument()
    })

    it('deletes a card that is not in the deck', async () => {
      const user = userEvent.setup()
      const calls = mockDeckApi(animals, {
        'POST /flashcards/delete': emptyResponse(204),
      })
      await showPage('/decks/7')
      await user.click(screen.getByRole('tab', { name: 'Add cards (2)' }))

      await clickDelete(user, 'Delete "la casa"', 'Delete "la casa"?')

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Deleted 1 card.',
      )
      const post = calls.find('POST')
      expect(post?.init?.body).toBe(JSON.stringify({ flashCardIds: [3] }))
      expect(
        screen.getByRole('tab', { name: 'Add cards (1)' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('tab', { name: 'In this deck (2)' }),
      ).toBeInTheDocument()
    })

    it('keeps the card and says why when deleting it fails', async () => {
      const user = userEvent.setup()
      mockDeckApi(animals, {
        'POST /flashcards/delete': emptyResponse(500),
      })
      await showPage('/decks/7')

      await clickDelete(user, 'Delete "el gato"', 'Delete "el gato"?')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Unable to delete the flash cards.',
      )
      expect(cardBox('el gato')).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'deleteCards',
      })
    })

    it('keeps the cards picked and says why when the change fails', async () => {
      const user = userEvent.setup()
      mockDeckApi(animals, { 'PATCH /decks/7/cards': emptyResponse(500) })
      await showPage('/decks/7')

      await user.click(cardBox('el gato'))
      await user.click(
        screen.getByRole('button', { name: 'Remove 1 card from deck' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Unable to change the deck.',
      )
      expect(cardBox('el gato')).toBeChecked()
    })

    it('shows a page of 50 cards at a time, and can pick all of them at once', async () => {
      const user = userEvent.setup()
      const many = Array.from({ length: 120 }, (_, index) =>
        card(index + 1, `palabra ${index + 1}`, `word ${index + 1}`),
      )
      mockDeckApi(
        { ...animals, flashCardIds: many.map(({ id }) => id) },
        undefined,
        many,
      )
      await showPage('/decks/7')

      expect(screen.getByText('1–50 of 120')).toBeInTheDocument()
      expect(cardBox('palabra 50')).toBeInTheDocument()
      expect(
        screen.queryByRole('checkbox', { name: 'Pick "palabra 51"' }),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Go to page 3' }))

      expect(screen.getByText('101–120 of 120')).toBeInTheDocument()
      expect(cardBox('palabra 120')).toBeInTheDocument()

      await user.click(screen.getByRole('checkbox', { name: 'Pick all 120' }))

      expect(
        screen.getByRole('button', { name: 'Remove 120 cards from deck' }),
      ).toBeEnabled()
      // Drawing 120 cards, each in its own collapse, takes about as long as the usual time allowed.
    }, 10000)

    it('renames the deck', async () => {
      const user = userEvent.setup()
      const calls = mockDeckApi(animals, {
        'PUT /decks/7': { ...animals, name: 'Pets' },
      })
      await showPage('/decks/7')

      await user.click(screen.getByRole('button', { name: 'Rename' }))
      const name = screen.getByLabelText('Deck name')
      expect(name).toHaveFocus()
      await user.clear(name)
      await user.type(name, 'Pets')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Pets' }),
      ).toBeInTheDocument()
      const put = calls.find('PUT')
      expect(put?.url).toBe(api('/decks/7'))
      expect(put?.init?.body).toBe(JSON.stringify({ name: 'Pets' }))
      expect(trackEvent).toHaveBeenCalledWith('DeckRenamed')
    })

    it('deletes the deck and goes back to the list', async () => {
      const user = userEvent.setup()
      const calls = mockDeckApi(animals, {
        'DELETE /decks/7': emptyResponse(204),
      })
      await showPage('/decks/7')

      await clickDelete(user, 'Delete deck', 'Delete deck "Animals"?')

      expect(
        await screen.findByRole('heading', { level: 2, name: 'New deck' }),
      ).toBeInTheDocument()
      expect(calls.find('DELETE')?.url).toBe(api('/decks/7'))
    })

    it('says so when the deck is gone', async () => {
      mockDeckApi(null)
      await showPage('/decks/7')

      expect(
        screen.getByRole('heading', { level: 2, name: 'Deck not found' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Go to decks' })).toHaveAttribute(
        'href',
        '/decks',
      )
    })
  })

  describe('adding cards from the cards page', () => {
    async function showCardsWithDecks(routes: Routes, path = '/') {
      const { calls } = mockApi({
        'GET /flashcards': cards,
        'GET /tags': [pets],
        'GET /decks': [animals],
        ...routes,
      })
      await showPage(path)
      return calls
    }

    it('adds the cards picked to a deck', async () => {
      const user = userEvent.setup()
      const calls = await showCardsWithDecks({
        'PATCH /decks/7/cards': { ...animals, flashCardIds: [1, 2, 3] },
      })

      expect(
        screen.getByRole('button', { name: 'Add to deck…' }),
      ).toBeDisabled()
      await user.click(screen.getByRole('checkbox', { name: 'Pick "la casa"' }))
      await user.click(
        screen.getByRole('button', { name: 'Add 1 card to deck…' }),
      )
      await user.click(screen.getByRole('menuitem', { name: 'Animals' }))

      const status = await screen.findByRole('status')
      expect(status).toHaveTextContent('Added 1 card to Animals.')
      expect(
        within(status).getByRole('link', { name: 'Animals' }),
      ).toHaveAttribute('href', '/decks/7')
      const patch = calls.find('PATCH')
      expect(patch?.url).toBe(api('/decks/7/cards'))
      expect(patch?.init?.body).toBe(JSON.stringify({ add: [3], remove: [] }))
      expect(
        screen.getByRole('checkbox', { name: 'Pick "la casa"' }),
      ).not.toBeChecked()
    })

    it("only picks all of the picked tag's cards", async () => {
      const user = userEvent.setup()
      const calls = await showCardsWithDecks(
        { 'PATCH /decks/7/cards': { ...animals } },
        '/?tag=4',
      )

      await user.click(screen.getByRole('checkbox', { name: 'Pick all 2' }))
      await user.click(
        screen.getByRole('button', { name: 'Add 2 cards to deck…' }),
      )
      await user.click(screen.getByRole('menuitem', { name: 'Animals' }))

      await screen.findByRole('status')
      expect(calls.find('PATCH')?.init?.body).toBe(
        JSON.stringify({ add: [1, 2], remove: [] }),
      )
    })

    it('makes a new deck from the cards picked', async () => {
      const user = userEvent.setup()
      let attempts = 0
      const calls = await showCardsWithDecks({
        'POST /decks': () =>
          attempts++ === 0
            ? jsonResponse(
                {
                  errors: {
                    Name: ["There's already a deck with that name."],
                  },
                },
                400,
              )
            : jsonResponse(deck(9, 'Home', [3, 4]), 201),
      })

      await user.click(screen.getByRole('checkbox', { name: 'Pick "la casa"' }))
      await user.click(
        screen.getByRole('checkbox', { name: 'Pick "la canción"' }),
      )
      await user.click(
        screen.getByRole('button', { name: 'Add 2 cards to deck…' }),
      )
      await user.click(screen.getByRole('menuitem', { name: 'New deck…' }))
      const dialog = await screen.findByRole('dialog', {
        name: 'New deck with 2 cards',
      })
      await user.type(within(dialog).getByLabelText('Deck name'), 'animals')
      await user.click(
        within(dialog).getByRole('button', { name: 'Create deck' }),
      )

      // The API's reason is shown in the dialog, which stays open to fix the name.
      expect(
        await within(dialog).findByText(
          "There's already a deck with that name.",
        ),
      ).toBeInTheDocument()

      await user.clear(within(dialog).getByLabelText('Deck name'))
      await user.type(within(dialog).getByLabelText('Deck name'), 'Home')
      await user.click(
        within(dialog).getByRole('button', { name: 'Create deck' }),
      )

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Added 2 cards to Home.',
      )
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      const posts = calls.filter('POST', '/decks')
      expect(posts.at(-1)?.init?.body).toBe(
        JSON.stringify({ name: 'Home', flashCardIds: [3, 4] }),
      )
      expect(trackException).not.toHaveBeenCalled()
    })
  })
})
