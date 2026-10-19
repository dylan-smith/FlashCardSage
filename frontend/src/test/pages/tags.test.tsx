import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlashCard, FlashCardFields, Tag } from '../../api/flashCards'
import { defaultPreferences } from '../../api/preferences'
import { tagSuggestDelayMs } from '../../hooks/useTagSuggestions'
import { storageKeys } from '../../lib/storageKeys'
import { trackEvent, trackException } from '../../telemetry'
import { api, card, tag } from '../support/factories'
import { emptyResponse, jsonResponse, mockApi } from '../support/mockApi'
import type { Answer, CallLog, Routes } from '../support/mockApi'
import {
  renderAt,
  renderLoaded,
  signInForEachTest,
  waitForLoaded,
} from '../support/render'

signInForEachTest()

describe('tags', () => {
  const food = tag(1, 'Food')
  const travel = tag(2, 'Travel')
  const apple = card(1, 'la manzana', 'the apple', { tags: [food] })
  const train = card(2, 'el tren', 'the train', { tags: [travel] })

  it("shows each card's tags and only the picked tag's cards", async () => {
    const user = userEvent.setup()
    await renderLoaded('/', {
      'GET /flashcards': [apple, train],
      'GET /tags': [food, travel],
    })

    const filter = screen.getByRole('group', { name: 'Show cards tagged' })
    expect(
      within(filter)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(['All (2)', 'Food (1)', 'Travel (1)'])
    expect(
      within(screen.getAllByRole('listitem')[0]).getByText('Food'),
    ).toBeInTheDocument()

    await user.click(within(filter).getByRole('button', { name: 'Travel (1)' }))

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('el tren')).toBeInTheDocument()
    expect(
      within(filter).getByRole('button', { name: 'Travel (1)' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(filter).getByRole('button', { name: 'All (2)' }))

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('says so when no card has the picked tag', async () => {
    const user = userEvent.setup()
    await renderLoaded('/', {
      'GET /flashcards': [apple],
      'GET /tags': [food, travel],
    })

    await user.click(screen.getByRole('button', { name: 'Travel (0)' }))

    expect(
      screen.getByText('No flash cards with this tag.'),
    ).toBeInTheDocument()
  })

  it('finds cards by either side as the search is typed, within the picked tag', async () => {
    const user = userEvent.setup()
    await renderLoaded('/', {
      'GET /flashcards': [apple, train],
      'GET /tags': [food, travel],
    })
    const search = screen.getByRole('searchbox', { name: 'Search' })

    await user.type(search, 'TREN')

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('el tren')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'the apple')

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('la manzana')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Travel (1)' }))

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText('No cards match.')).toBeInTheDocument()
  })

  it('sends the tags typed in for a new card and adds new ones to the list', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({
      'GET /flashcards': [apple],
      'GET /tags': [food],
      'POST /flashcards': jsonResponse(
        card(3, 'el pan', 'the bread', { tags: [tag(3, 'Bakery'), food] }),
        201,
      ),
    })
    renderAt('/')
    await screen.findByText('la manzana')

    await user.type(
      screen.getByLabelText('Spanish', { exact: false }),
      'el pan',
    )
    await user.type(
      screen.getByLabelText('English', { exact: false }),
      'the bread',
    )
    const tagsInput = screen.getByLabelText('Tags')
    await user.type(tagsInput, 'Food{Enter}')
    // Left typed in without Enter, it's still added when the form is sent.
    await user.type(tagsInput, 'Bakery')
    await user.click(screen.getByRole('button', { name: 'Add flash card' }))

    expect(await screen.findByText('el pan')).toBeInTheDocument()
    const post = calls.find('POST')
    expect(post?.init?.body).toBe(
      JSON.stringify({
        spanish: ['el pan'],
        english: ['the bread'],
        tags: ['Food', 'Bakery'],
      }),
    )
    expect(
      screen.getByRole('button', { name: 'Bakery (1)' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Food (2)' })).toBeInTheDocument()
  })

  it("changes a card's tags", async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({
      'GET /flashcards': [apple],
      'GET /tags': [food, travel],
      'PUT /flashcards/1': { ...apple, tags: [food, travel] },
    })
    renderAt('/')
    await screen.findByText('la manzana')

    await user.click(screen.getByRole('button', { name: 'Edit "la manzana"' }))
    const item = screen.getAllByRole('listitem')[0]
    expect(
      within(item).getByRole('button', { name: 'Food' }),
    ).toBeInTheDocument()
    await user.type(within(item).getByLabelText('Tags'), 'Travel{Enter}')
    await user.click(within(item).getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByRole('button', { name: 'Travel (1)' }),
    ).toBeInTheDocument()
    const put = calls.find('PUT')
    expect(put?.init?.body).toBe(
      JSON.stringify({
        spanish: ['la manzana'],
        english: ['the apple'],
        tags: ['Food', 'Travel'],
      }),
    )
  })

  describe('suggested tags', () => {
    // waitFor gives up after a second by default, which is about how long the suggestions wait for typing to stop.
    const untilSuggested = { timeout: tagSuggestDelayMs + 1000 }

    // The time the suggestions wait for typing to stop passes without waiting for it.
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    // Long enough for suggestions to have been asked for, for checking that they weren't.
    function waitPastSuggestDelay() {
      return act(() => vi.advanceTimersByTimeAsync(tagSuggestDelayMs + 200))
    }

    // Answers from routes. These tests type one side of a card, so it isn't translated. tagSuggestionRequests has
    // the cards suggestions were asked for.
    function mockTagSuggestions(routes: Routes) {
      const mock = mockApi({
        'GET /preferences': { ...defaultPreferences, autoTranslate: false },
        ...routes,
      })
      const tagSuggestionRequests = () =>
        mock.background
          .filter('POST', '/tag-suggestions')
          .map((call) => call.body as FlashCardFields)
      return { ...mock, tagSuggestionRequests }
    }

    // Renders the flash cards page with these cards and tags already loaded, answering suggestions as told.
    async function showCards(
      cards: FlashCard[],
      tags: Tag[],
      suggestTags: Answer = emptyResponse(503),
      routes: Routes = {},
    ) {
      const mock = mockTagSuggestions({
        'GET /flashcards': cards,
        'GET /tags': tags,
        'POST /tag-suggestions': suggestTags,
        ...routes,
      })
      renderAt('/')
      await waitForLoaded()
      return mock
    }

    it('suggests tags for a new card, and adds the one the user clicks', async () => {
      const user = userEvent.setup()
      const { calls, tagSuggestionRequests } = mockTagSuggestions({
        'GET /flashcards': [apple, train],
        'GET /tags': [food, travel],
        'POST /tag-suggestions': [food],
        'POST /flashcards': jsonResponse(
          { ...train, id: 3, spanish: ['el pan'], tags: [food] },
          201,
        ),
      })
      renderAt('/')
      await screen.findByText('la manzana')

      await user.type(
        screen.getByLabelText('Spanish', { exact: false }),
        'el pan',
      )

      const chip = await screen.findByRole(
        'button',
        { name: 'Add tag Food' },
        untilSuggested,
      )
      expect(screen.getByText('Suggested tags:')).toBeInTheDocument()
      expect(tagSuggestionRequests()).toEqual([
        { spanish: ['el pan'], english: [], tags: [] },
      ])

      await user.click(chip)

      expect(screen.queryByText('Suggested tags:')).not.toBeInTheDocument()
      await user.type(
        screen.getByLabelText('English', { exact: false }),
        'the bread',
      )
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      const post = await waitFor(() => {
        const sent = calls.find('POST')
        expect(sent).toBeDefined()
        return sent
      })
      expect(post?.init?.body).toBe(
        JSON.stringify({
          spanish: ['el pan'],
          english: ['the bread'],
          tags: ['Food'],
        }),
      )
    })

    it('suggests tags for a card being edited, leaving out the ones it has', async () => {
      const user = userEvent.setup()
      const { calls, tagSuggestionRequests } = mockTagSuggestions({
        'GET /flashcards': [apple],
        'GET /tags': [food, travel],
        'POST /tag-suggestions': [food, travel],
        'PUT /flashcards/1': { ...apple, tags: [food, travel] },
      })
      renderAt('/')
      await screen.findByText('la manzana')

      await user.click(
        screen.getByRole('button', { name: 'Edit "la manzana"' }),
      )
      const item = screen.getAllByRole('listitem')[0]
      await user.click(
        await within(item).findByRole(
          'button',
          { name: 'Add tag Travel' },
          untilSuggested,
        ),
      )
      expect(
        within(item).queryByRole('button', { name: 'Add tag Food' }),
      ).not.toBeInTheDocument()
      await user.click(within(item).getByRole('button', { name: 'Save' }))

      expect(
        await screen.findByRole('button', { name: 'Travel (1)' }),
      ).toBeInTheDocument()
      expect(tagSuggestionRequests()).toEqual([
        { spanish: ['la manzana'], english: ['the apple'], tags: ['Food'] },
      ])
      const put = calls.find('PUT')
      expect(put?.init?.body).toBe(
        JSON.stringify({
          spanish: ['la manzana'],
          english: ['the apple'],
          tags: ['Food', 'Travel'],
        }),
      )
    })

    it('takes the suggestions away when the words change', async () => {
      const user = userEvent.setup()
      const { routes, tagSuggestionRequests } = await showCards(
        [apple],
        [food],
        [food],
      )
      const spanish = screen.getByLabelText('Spanish', { exact: false })
      await user.type(spanish, 'el pan')
      await screen.findByText('Suggested tags:', {}, untilSuggested)

      routes['POST /tag-suggestions'] = []
      await user.type(spanish, 'adero')

      expect(screen.queryByText('Suggested tags:')).not.toBeInTheDocument()
      await waitFor(
        () => expect(tagSuggestionRequests()).toHaveLength(2),
        untilSuggested,
      )
      expect(tagSuggestionRequests()[1].spanish).toEqual(['el panadero'])
      expect(screen.queryByText('Suggested tags:')).not.toBeInTheDocument()
    })

    it('says it is suggesting tags until the answer comes, and then nothing when no tag fits', async () => {
      const user = userEvent.setup()
      let answer: (response: Response) => void = () => undefined
      await showCards(
        [apple],
        [food],
        () =>
          new Promise((resolve) => {
            answer = resolve
          }),
      )

      await user.type(
        screen.getByLabelText('Spanish', { exact: false }),
        'el pan',
      )

      expect(
        await screen.findByText('Suggesting tags…', {}, untilSuggested),
      ).toBeInTheDocument()
      answer(jsonResponse([]))
      await waitFor(() =>
        expect(screen.queryByText('Suggesting tags…')).not.toBeInTheDocument(),
      )
      expect(screen.queryByText('Suggested tags:')).not.toBeInTheDocument()
    })

    it("doesn't ask once they aren't available", async () => {
      const user = userEvent.setup()
      const { tagSuggestionRequests } = await showCards([apple], [food])
      const spanish = screen.getByLabelText('Spanish', { exact: false })
      await user.type(spanish, 'el pan')
      await waitFor(
        () => expect(tagSuggestionRequests()).toHaveLength(1),
        untilSuggested,
      )

      await user.type(spanish, 'adero')
      await waitPastSuggestDelay()

      expect(tagSuggestionRequests()).toHaveLength(1)
      expect(screen.queryByText('Suggested tags:')).not.toBeInTheDocument()
    })

    it("doesn't ask when the user has no tags", async () => {
      const user = userEvent.setup()
      const { tagSuggestionRequests } = await showCards([], [], [food])

      await user.type(
        screen.getByLabelText('Spanish', { exact: false }),
        'el pan',
      )
      await waitPastSuggestDelay()

      expect(tagSuggestionRequests()).toEqual([])
    })

    it("doesn't ask when the user turned suggestions off", async () => {
      const user = userEvent.setup()
      const { tagSuggestionRequests } = await showCards(
        [apple],
        [food],
        [food],
        {
          'GET /preferences': {
            ...defaultPreferences,
            autoTranslate: false,
            showSuggestions: false,
          },
        },
      )

      await user.type(
        screen.getByLabelText('Spanish', { exact: false }),
        'el pan',
      )
      await waitPastSuggestDelay()

      expect(tagSuggestionRequests()).toEqual([])
    })
  })

  describe('the Tags page', () => {
    const pear = card(3, 'la pera', 'the pear', { tags: [food] })

    // Renders the Tags page, answering each change from routes.
    async function showTags(routes: Routes = {}) {
      const mock = mockApi({
        'GET /flashcards': [apple, train, pear],
        'GET /tags': [food, travel],
        ...routes,
      })
      renderAt('/tags')
      await screen.findByRole('link', { name: 'Food' })
      return mock
    }

    const nameTaken = jsonResponse(
      { errors: { Name: ["There's already a tag with that name."] } },
      400,
    )

    it('lists the tags with how many cards have each, linking to their cards', async () => {
      await showTags()

      const items = within(screen.getByRole('list')).getAllByRole('listitem')
      expect(items.map((item) => item.textContent)).toEqual([
        expect.stringContaining('Food2 cards'),
        expect.stringContaining('Travel1 card'),
      ])
      expect(screen.getByRole('link', { name: 'Food' })).toHaveAttribute(
        'href',
        '/?tag=1',
      )
    })

    it('renames a tag', async () => {
      const user = userEvent.setup()
      const { calls } = await showTags({
        'PUT /tags/1': tag(1, 'Groceries'),
      })

      await user.click(
        screen.getByRole('button', { name: 'Rename tag "Food"' }),
      )
      const name = screen.getByLabelText('Tag name')
      expect(name).toHaveFocus()
      await user.clear(name)
      await user.type(name, ' Groceries ')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(
        await screen.findByRole('link', { name: 'Groceries' }),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText('Tag name')).not.toBeInTheDocument()
      const put = calls.find('PUT')
      expect(put?.url).toBe(api('/tags/1'))
      expect(put?.init?.body).toBe(JSON.stringify({ name: 'Groceries' }))
      expect(trackEvent).toHaveBeenCalledWith('TagRenamed')
    })

    it("shows the API's reason when it rejects a new name", async () => {
      const user = userEvent.setup()
      await showTags({ 'PUT /tags/1': nameTaken })

      await user.click(
        screen.getByRole('button', { name: 'Rename tag "Food"' }),
      )
      await user.clear(screen.getByLabelText('Tag name'))
      await user.type(screen.getByLabelText('Tag name'), 'travel')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "There's already a tag with that name.",
      )
      expect(screen.getByLabelText('Tag name')).toHaveValue('travel')
      expect(trackException).not.toHaveBeenCalled()
    })

    it('deletes a tag', async () => {
      const user = userEvent.setup()
      const { calls, routes } = await showTags({
        'DELETE /tags/1': emptyResponse(204),
      })

      await screen.findByRole('link', { name: 'Tags 0' })
      routes['GET /counts'] = { cards: 0, decks: 0, tags: 1 }

      await user.click(
        screen.getByRole('button', { name: 'Delete tag "Food"' }),
      )
      const dialog = await screen.findByRole('dialog', {
        name: 'Delete tag "Food"?',
      })
      expect(dialog).toHaveTextContent("This can't be undone.")
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(
          screen.queryByRole('link', { name: 'Food' }),
        ).not.toBeInTheDocument()
      })
      expect(screen.getByRole('link', { name: 'Travel' })).toBeInTheDocument()
      // The counts in the navigation are loaded again.
      expect(
        await screen.findByRole('link', { name: 'Tags 1' }),
      ).toBeInTheDocument()
      expect(calls.find('DELETE')?.url).toBe(api('/tags/1'))
      expect(trackEvent).toHaveBeenCalledWith('TagDeleted')
    })

    it('replaces a deleted tag with another, merging their cards', async () => {
      const user = userEvent.setup()
      const { calls } = await showTags({
        'DELETE /tags/1': emptyResponse(204),
      })

      await user.click(
        screen.getByRole('button', { name: 'Delete tag "Food"' }),
      )
      const dialog = await screen.findByRole('dialog', {
        name: 'Delete tag "Food"?',
      })
      const replaceWith = within(dialog).getByRole('combobox', {
        name: 'Replace with',
      })
      expect(replaceWith).toHaveTextContent('No tag')
      await user.click(replaceWith)
      const options = within(screen.getByRole('listbox')).getAllByRole('option')
      expect(options.map((option) => option.textContent)).toEqual([
        'No tag',
        'Travel',
      ])
      await user.click(screen.getByRole('option', { name: 'Travel' }))
      expect(dialog).toHaveTextContent(
        '"Travel" will take its place on its 2 cards',
      )
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(
          screen.queryByRole('link', { name: 'Food' }),
        ).not.toBeInTheDocument()
      })
      const items = within(screen.getByRole('list')).getAllByRole('listitem')
      expect(items.map((item) => item.textContent)).toEqual([
        expect.stringContaining('Travel3 cards'),
      ])
      expect(calls.find('DELETE')?.url).toBe(api('/tags/1?replaceWith=2'))
      expect(trackEvent).toHaveBeenCalledWith('TagReplaced')
    })

    it('creates a tag with no cards', async () => {
      const user = userEvent.setup()
      const { calls } = await showTags({
        'POST /tags': jsonResponse(tag(5, 'Animals'), 201),
      })

      const name = screen.getByLabelText('New tag name', { exact: false })
      await user.type(name, ' Animals ')
      await user.click(screen.getByRole('button', { name: 'Create tag' }))

      expect(
        await screen.findByRole('link', { name: 'Animals' }),
      ).toHaveAttribute('href', '/?tag=5')
      const items = within(screen.getByRole('list')).getAllByRole('listitem')
      expect(items.map((item) => item.textContent)).toEqual([
        expect.stringContaining('Animals0 cards'),
        expect.stringContaining('Food2 cards'),
        expect.stringContaining('Travel1 card'),
      ])
      expect(name).toHaveValue('')
      const post = calls.find('POST')
      expect(post?.url).toBe(api('/tags'))
      expect(post?.init?.body).toBe(JSON.stringify({ name: 'Animals' }))
      expect(trackEvent).toHaveBeenCalledWith('TagCreated')
    })

    it("shows the API's reason when it rejects a new tag", async () => {
      const user = userEvent.setup()
      await showTags({ 'POST /tags': nameTaken })

      const name = screen.getByLabelText('New tag name', { exact: false })
      await user.type(name, 'food')
      await user.click(screen.getByRole('button', { name: 'Create tag' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "There's already a tag with that name.",
      )
      expect(name).toHaveValue('food')
      expect(trackException).not.toHaveBeenCalled()
    })

    it('says when there are no tags yet', async () => {
      mockApi()
      renderAt('/tags')

      expect(
        await screen.findByText(/You haven't made any tags yet\./),
      ).toBeInTheDocument()
    })

    describe('suggested tags', () => {
      beforeEach(() => {
        localStorage.removeItem(storageKeys.tagSuggestionsCollapsed)
      })

      function suggestedTags() {
        return within(
          screen.getByRole('list', { name: 'Suggested tags' }),
        ).getAllByRole('listitem')
      }

      // How many times new tags were suggested.
      function suggestionRequests(background: CallLog) {
        return background.filter('GET', '/tag-suggestions/new').length
      }

      it('suggests new tags, leaving out ones the user has', async () => {
        await showTags({
          'GET /tag-suggestions/new': ['Animals', 'food', 'Colors'],
        })

        await screen.findByRole('list', { name: 'Suggested tags' })
        expect(suggestedTags().map((item) => item.textContent)).toEqual([
          expect.stringContaining('Animals'),
          expect.stringContaining('Colors'),
        ])
        expect(
          screen.getByText('New tags that go with your cards.'),
        ).toBeInTheDocument()
      })

      it("isn't shown when suggestions aren't available", async () => {
        const { background } = await showTags()

        await waitFor(() => {
          expect(suggestionRequests(background)).toBe(1)
          expect(
            screen.queryByLabelText('Loading suggestions'),
          ).not.toBeInTheDocument()
        })
        expect(
          screen.queryByRole('button', { name: 'Suggested tags' }),
        ).not.toBeInTheDocument()
      })

      it("isn't shown or asked for when the user has turned suggestions off", async () => {
        const { background } = await showTags({
          'GET /preferences': {
            ...defaultPreferences,
            showSuggestions: false,
          },
          'GET /tag-suggestions/new': ['Animals'],
        })

        expect(
          screen.queryByRole('button', { name: 'Suggested tags' }),
        ).not.toBeInTheDocument()
        expect(suggestionRequests(background)).toBe(0)
      })

      it('adds a suggested tag', async () => {
        const user = userEvent.setup()
        const { calls } = await showTags({
          'GET /tag-suggestions/new': ['Animals', 'Colors'],
          'POST /tags': jsonResponse(tag(5, 'Animals'), 201),
        })

        await user.click(
          await screen.findByRole('button', { name: 'Add tag "Animals"' }),
        )

        expect(
          await screen.findByRole('link', { name: 'Animals' }),
        ).toHaveAttribute('href', '/?tag=5')
        expect(suggestedTags().map((item) => item.textContent)).toEqual([
          expect.stringContaining('Colors'),
        ])
        const post = calls.find('POST')
        expect(post?.url).toBe(api('/tags'))
        expect(post?.init?.body).toBe(JSON.stringify({ name: 'Animals' }))
        expect(trackEvent).toHaveBeenCalledWith('SuggestedTagAdded')
      })

      it("keeps a suggestion that couldn't be saved, and says why", async () => {
        const user = userEvent.setup()
        await showTags({
          'GET /tag-suggestions/new': ['Animals'],
          'POST /tags': nameTaken,
        })

        await user.click(
          await screen.findByRole('button', { name: 'Add tag "Animals"' }),
        )

        expect(await screen.findByRole('alert')).toHaveTextContent(
          "There's already a tag with that name.",
        )
        expect(
          screen.getByRole('button', { name: 'Add tag "Animals"' }),
        ).toBeEnabled()
      })

      it('asks for more suggestions, leaving out the ones already shown', async () => {
        const user = userEvent.setup()
        const { background, routes } = await showTags({
          'GET /tag-suggestions/new': ['Animals', 'Colors'],
        })
        await screen.findByRole('button', { name: 'Add tag "Animals"' })

        routes['GET /tag-suggestions/new'] = ['Weather']
        await user.click(
          screen.getByRole('button', { name: 'More suggestions' }),
        )

        expect(
          await screen.findByRole('button', { name: 'Add tag "Weather"' }),
        ).toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Add tag "Animals"' }),
        ).not.toBeInTheDocument()

        routes['GET /tag-suggestions/new'] = ['Numbers']
        await user.click(
          screen.getByRole('button', { name: 'More suggestions' }),
        )

        expect(
          await screen.findByRole('button', { name: 'Add tag "Numbers"' }),
        ).toBeInTheDocument()
        const requests = background.filter('GET', '/tag-suggestions/new')
        expect(requests.map((call) => call.query.getAll('exclude'))).toEqual([
          [],
          ['Animals', 'Colors'],
          ['Animals', 'Colors', 'Weather'],
        ])
        expect(suggestionRequests(background)).toBe(3)
      })

      it('says when suggesting failed, and tries again', async () => {
        const user = userEvent.setup()
        const { routes } = await showTags({
          'GET /tag-suggestions/new': emptyResponse(502),
        })

        expect(
          await screen.findByText('Unable to suggest tags right now.'),
        ).toBeInTheDocument()
        expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
          operation: 'suggestTags',
        })

        routes['GET /tag-suggestions/new'] = ['Animals']
        await user.click(screen.getByRole('button', { name: 'Try again' }))

        expect(
          await screen.findByRole('button', { name: 'Add tag "Animals"' }),
        ).toBeInTheDocument()
      })

      it('collapses, and stays collapsed after a reload', async () => {
        const user = userEvent.setup()
        await showTags({ 'GET /tag-suggestions/new': ['Animals'] })
        const heading = await screen.findByRole('button', {
          name: 'Suggested tags',
        })
        expect(heading).toHaveAttribute('aria-expanded', 'true')

        await user.click(heading)

        expect(heading).toHaveAttribute('aria-expanded', 'false')
        await waitFor(() => {
          expect(
            screen.queryByRole('list', { name: 'Suggested tags' }),
          ).not.toBeInTheDocument()
        })
        expect(localStorage.getItem(storageKeys.tagSuggestionsCollapsed)).toBe(
          'true',
        )
      })
    })

    it("leaves renaming and deleting to the Tags page, so the cards page's chips only filter", async () => {
      const user = userEvent.setup()
      mockApi({
        'GET /flashcards': [apple, train],
        'GET /tags': [food, travel],
      })
      renderAt('/')
      await screen.findByText('la manzana')

      await user.click(screen.getByRole('button', { name: 'Food (1)' }))

      expect(
        screen.queryByRole('button', { name: /^(Rename|Delete) tag/ }),
      ).not.toBeInTheDocument()
    })
  })

  it('shows every card when the tag in the address no longer exists', async () => {
    mockApi({ 'GET /flashcards': [apple, train], 'GET /tags': [food] })

    renderAt('/?tag=99')

    expect(await screen.findAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'All (2)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('starts with the tag in the address picked', async () => {
    mockApi({
      'GET /flashcards': [apple, train],
      'GET /tags': [food, travel],
    })

    renderAt('/?tag=2')

    expect(await screen.findAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('el tren')).toBeInTheDocument()
  })
})
