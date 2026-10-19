import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultPreferences } from '../../api/preferences'
import { storageKeys } from '../../lib/storageKeys'
import { trackEvent, trackException } from '../../telemetry'
import { api, card, cat, dog, tag } from '../support/factories'
import { jsonResponse, mockApi } from '../support/mockApi'
import type { Call, Routes } from '../support/mockApi'
import { renderAt, signInForEachTest } from '../support/render'

signInForEachTest()

describe('suggested cards', () => {
  // Renders the flash cards page with the cat, answering suggestions with suggest and anything else from routes.
  async function showSuggestions(
    suggest: (url: string) => Promise<Response>,
    routes: Routes = {},
  ) {
    const { calls } = mockApi({
      'GET /flashcards': [cat],
      'GET /card-suggestions': (call: Call) => suggest(call.url),
      ...routes,
    })
    renderAt('/')
    await screen.findByText('el gato')
    return calls
  }

  function suggestionList() {
    return screen.getByRole('list', { name: 'Suggested cards' })
  }

  it('shows the suggestions, leaving out any the user has a card for', async () => {
    await showSuggestions(async () =>
      jsonResponse([
        { spanish: 'el perro', english: 'the dog' },
        { spanish: 'El Gato', english: 'the kitty' },
        { spanish: 'el pez', english: 'the fish' },
      ]),
    )

    expect(
      screen.getByRole('heading', { level: 2, name: 'Suggested cards' }),
    ).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Suggested cards' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('el perrothe dog')
    expect(items[1]).toHaveTextContent('el pezthe fish')
  })

  it("isn't shown when suggestions aren't available", async () => {
    await showSuggestions(async () => new Response(null, { status: 503 }))

    expect(
      screen.queryByRole('heading', { name: 'Suggested cards' }),
    ).not.toBeInTheDocument()
    expect(trackException).not.toHaveBeenCalled()
  })

  it("isn't shown or asked for when the user turned suggestions off", async () => {
    const suggest = vi.fn(async () =>
      jsonResponse([{ spanish: 'el perro', english: 'the dog' }]),
    )

    await showSuggestions(suggest, {
      'GET /preferences': { ...defaultPreferences, showSuggestions: false },
    })

    expect(
      screen.queryByRole('heading', { name: 'Suggested cards' }),
    ).not.toBeInTheDocument()
    expect(suggest).not.toHaveBeenCalled()
  })

  it('adds a suggestion as a card and takes it off the suggestions', async () => {
    const user = userEvent.setup()
    const calls = await showSuggestions(
      async () =>
        jsonResponse([
          { spanish: 'el perro', english: 'the dog' },
          { spanish: 'el pez', english: 'the fish' },
        ]),
      { 'POST /flashcards': jsonResponse(dog, 201) },
    )
    await screen.findByRole('list', { name: 'Suggested cards' })

    await user.click(screen.getByRole('button', { name: 'Add "el perro"' }))

    await waitFor(() => {
      expect(within(suggestionList()).getAllByRole('listitem')).toHaveLength(1)
    })
    expect(suggestionList()).toHaveTextContent('el pez')
    expect(
      screen.getByRole('button', { name: 'Edit "el perro"' }),
    ).toBeInTheDocument()
    const post = calls.find('POST')
    expect(post?.init?.body).toBe(
      JSON.stringify({
        spanish: ['el perro'],
        english: ['the dog'],
        tags: [],
      }),
    )
    expect(trackEvent).toHaveBeenCalledWith('SuggestedFlashCardAdded')
  })

  it('keeps a suggestion that fails to save and says why', async () => {
    const user = userEvent.setup()
    await showSuggestions(
      async () => jsonResponse([{ spanish: 'el perro', english: 'the dog' }]),
      {
        'POST /flashcards': jsonResponse(
          { detail: 'You already have a flash card with this English.' },
          409,
        ),
      },
    )
    await screen.findByRole('list', { name: 'Suggested cards' })

    await user.click(screen.getByRole('button', { name: 'Add "el perro"' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already have a flash card with this English.',
    )
    expect(suggestionList()).toHaveTextContent('el perro')
    expect(trackException).not.toHaveBeenCalled()
  })

  it('edits a suggestion with the card form before adding it', async () => {
    const user = userEvent.setup()
    const calls = await showSuggestions(
      async () =>
        jsonResponse([
          { spanish: 'el perro', english: 'the dog' },
          { spanish: 'el pez', english: 'the fish' },
        ]),
      {
        'POST /flashcards': jsonResponse(
          {
            id: 2,
            spanish: ['el perro'],
            english: ['the dog', 'the hound'],
            tags: ['Pets'],
            imageUrl: null,
          },
          201,
        ),
      },
    )
    await screen.findByRole('list', { name: 'Suggested cards' })

    await user.click(screen.getByRole('button', { name: 'Edit "el perro"' }))
    const item = within(suggestionList()).getAllByRole('listitem')[0]
    expect(within(item).getByLabelText('Spanish')).toHaveValue('el perro')
    expect(within(item).getByLabelText('Spanish')).toHaveFocus()
    expect(
      within(suggestionList()).getByRole('button', { name: 'Add "el pez"' }),
    ).toBeDisabled()
    await user.click(
      within(item).getByRole('button', { name: 'Add English translation' }),
    )
    await user.type(within(item).getByLabelText('English 2'), 'the hound')
    await user.type(within(item).getByLabelText('Tags'), 'Pets{Enter}')
    await user.click(within(item).getByRole('button', { name: 'Save' }))

    expect(suggestionList()).toHaveTextContent('the dog / the hound')
    expect(suggestionList()).toHaveTextContent('Pets')
    expect(calls.filter('POST')).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Add "el perro"' }))

    await waitFor(() => {
      expect(within(suggestionList()).getAllByRole('listitem')).toHaveLength(1)
    })
    const post = calls.find('POST')
    expect(post?.init?.body).toBe(
      JSON.stringify({
        spanish: ['el perro'],
        english: ['the dog', 'the hound'],
        tags: ['Pets'],
      }),
    )
  })

  it('keeps a suggestion as it was when its edit is cancelled', async () => {
    const user = userEvent.setup()
    await showSuggestions(async () =>
      jsonResponse([{ spanish: 'el perro', english: 'the dog' }]),
    )
    await screen.findByRole('list', { name: 'Suggested cards' })

    await user.click(screen.getByRole('button', { name: 'Edit "el perro"' }))
    await user.clear(screen.getByDisplayValue('the dog'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('English is required.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(suggestionList()).toHaveTextContent('el perrothe dog')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('asks for more suggestions, leaving out the ones already shown', async () => {
    const user = userEvent.setup()
    const suggest = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse([
          { spanish: 'el perro', english: 'the dog' },
          { spanish: 'el gato', english: 'the cat' },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ spanish: 'el pez', english: 'the fish' }]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ spanish: 'la vaca', english: 'the cow' }]),
      )
    await showSuggestions(suggest)
    await screen.findByRole('list', { name: 'Suggested cards' })

    await user.click(screen.getByRole('button', { name: 'More suggestions' }))

    await waitFor(() => {
      expect(suggestionList()).toHaveTextContent('el pez')
    })
    expect(suggestionList()).not.toHaveTextContent('el perro')

    await user.click(screen.getByRole('button', { name: 'More suggestions' }))

    await waitFor(() => {
      expect(suggestionList()).toHaveTextContent('la vaca')
    })
    expect(suggest.mock.calls.map(([url]) => url)).toEqual([
      api('/card-suggestions'),
      api('/card-suggestions?exclude=el+perro&exclude=el+gato'),
      api('/card-suggestions?exclude=el+perro&exclude=el+gato&exclude=el+pez'),
    ])
  })

  it('suggests cards related to a card just added', async () => {
    const user = userEvent.setup()
    const suggest = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse([{ spanish: 'el pez', english: 'the fish' }]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ spanish: 'el collar', english: 'the collar' }]),
      )
    await showSuggestions(suggest, {
      'POST /flashcards': jsonResponse(dog, 201),
    })
    await screen.findByRole('list', { name: 'Suggested cards' })

    await user.type(
      screen.getByLabelText('Spanish', { exact: false }),
      'el perro',
    )
    await user.type(
      screen.getByLabelText('English', { exact: false }),
      'the dog',
    )
    await user.click(screen.getByRole('button', { name: 'Add flash card' }))

    await waitFor(() => {
      expect(suggestionList()).toHaveTextContent('el collar')
    })
    expect(suggestionList()).not.toHaveTextContent('el pez')
    expect(
      screen.getByText('New words and phrases that go with “el perro”.'),
    ).toBeInTheDocument()
    expect(suggest).toHaveBeenLastCalledWith(
      api('/card-suggestions?relatedTo=2'),
    )
  })

  describe('for a tag', () => {
    const food = tag(5, 'Food')
    const bread = card(3, 'el pan', 'the bread', { tags: [food] })

    // Renders the page at path with the cat and the bread, answering suggestions with suggest and a new card with
    // the cheese.
    function showTagged(
      path: string,
      suggest: (url: string) => Promise<Response>,
    ) {
      const { calls } = mockApi({
        'GET /flashcards': [cat, bread],
        'GET /tags': [food],
        'GET /card-suggestions': (call: Call) => suggest(call.url),
        'POST /flashcards': jsonResponse(
          card(4, 'el queso', 'the cheese', { tags: [food] }),
          201,
        ),
      })
      renderAt(path)
      return calls
    }

    it('suggests cards for the picked tag and adds them with it', async () => {
      const user = userEvent.setup()
      const suggest = vi
        .fn<(url: string) => Promise<Response>>()
        .mockResolvedValueOnce(
          jsonResponse([{ spanish: 'el perro', english: 'the dog' }]),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ spanish: 'el queso', english: 'the cheese' }]),
        )
      const calls = showTagged('/', suggest)
      await screen.findByRole('list', { name: 'Suggested cards' })

      await user.click(screen.getByRole('button', { name: 'Food (1)' }))

      await waitFor(() => {
        expect(suggestionList()).toHaveTextContent('el queso')
      })
      expect(suggest).toHaveBeenLastCalledWith(api('/card-suggestions?tag=5'))
      expect(
        screen.getByText('New words and phrases for your “Food” cards.'),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Add "el queso"' }))

      expect(
        await screen.findByRole('button', { name: 'Edit "el queso"' }),
      ).toBeInTheDocument()
      const post = calls.find('POST')
      expect(post?.init?.body).toBe(
        JSON.stringify({
          spanish: ['el queso'],
          english: ['the cheese'],
          tags: ['Food'],
        }),
      )
    })

    it('waits for the tags when the page opens on one', async () => {
      const suggest = vi
        .fn<(url: string) => Promise<Response>>()
        .mockResolvedValue(
          jsonResponse([{ spanish: 'el queso', english: 'the cheese' }]),
        )
      showTagged('/?tag=5', suggest)

      expect(
        await screen.findByRole('list', { name: 'Suggested cards' }),
      ).toHaveTextContent('el queso')
      expect(suggest).toHaveBeenCalledExactlyOnceWith(
        api('/card-suggestions?tag=5'),
      )
    })

    it('suggests cards under the tag of a card just added, not the picked one', async () => {
      const user = userEvent.setup()
      const seasons = tag(6, 'Seasons')
      const suggest = vi
        .fn<(url: string) => Promise<Response>>()
        .mockResolvedValueOnce(
          jsonResponse([{ spanish: 'el queso', english: 'the cheese' }]),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ spanish: 'el verano', english: 'the summer' }]),
        )
      // The winter, added with the form, then the summer, added from the suggestions.
      const saved = [
        card(4, 'el invierno', 'the winter', { tags: [seasons] }),
        card(7, 'el verano', 'the summer', { tags: [seasons] }),
      ]
      const { calls } = mockApi({
        'GET /flashcards': [cat, bread],
        'GET /tags': [food, seasons],
        'GET /card-suggestions': (call: Call) => suggest(call.url),
        'POST /flashcards': () => jsonResponse(saved.shift(), 201),
      })
      renderAt('/?tag=5')
      await screen.findByRole('list', { name: 'Suggested cards' })

      await user.type(
        screen.getByLabelText('Spanish', { exact: false }),
        'el invierno',
      )
      await user.type(
        screen.getByLabelText('English', { exact: false }),
        'the winter',
      )
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      await waitFor(() => {
        expect(suggestionList()).toHaveTextContent('el verano')
      })
      expect(suggest).toHaveBeenLastCalledWith(
        api('/card-suggestions?relatedTo=4&tag=6'),
      )
      expect(
        screen.getByText(
          'New “Seasons” words and phrases that go with “el invierno”.',
        ),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Add "el verano"' }))

      await waitFor(() => {
        expect(saved).toHaveLength(0)
      })
      const posts = calls.filter('POST')
      expect(posts.at(-1)?.init?.body).toBe(
        JSON.stringify({
          spanish: ['el verano'],
          english: ['the summer'],
          tags: ['Seasons'],
        }),
      )
    })
  })

  it('says so when suggestions fail, and tries again', async () => {
    const user = userEvent.setup()
    const suggest = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(
        jsonResponse([{ spanish: 'el perro', english: 'the dog' }]),
      )
    await showSuggestions(suggest)

    expect(
      await screen.findByText('Unable to suggest cards right now.'),
    ).toBeInTheDocument()
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'suggest',
    })

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByRole('list', { name: 'Suggested cards' }),
    ).toHaveTextContent('el perro')
  })

  describe('collapsing', () => {
    afterEach(() => {
      localStorage.removeItem(storageKeys.suggestionsCollapsed)
    })

    it('collapses and expands the suggestions, remembering the choice', async () => {
      const user = userEvent.setup()
      await showSuggestions(async () =>
        jsonResponse([{ spanish: 'el perro', english: 'the dog' }]),
      )
      await screen.findByRole('list', { name: 'Suggested cards' })
      const toggle = screen.getByRole('button', { name: 'Suggested cards' })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')

      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await waitFor(() => {
        expect(
          screen.queryByRole('list', { name: 'Suggested cards' }),
        ).not.toBeInTheDocument()
      })
      expect(localStorage.getItem(storageKeys.suggestionsCollapsed)).toBe(
        'true',
      )

      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(
        await screen.findByRole('list', { name: 'Suggested cards' }),
      ).toHaveTextContent('el perro')
      expect(localStorage.getItem(storageKeys.suggestionsCollapsed)).toBeNull()
    })

    it('starts collapsed when the user collapsed it before', async () => {
      localStorage.setItem(storageKeys.suggestionsCollapsed, 'true')
      await showSuggestions(async () =>
        jsonResponse([{ spanish: 'el perro', english: 'the dog' }]),
      )

      expect(
        await screen.findByRole('button', { name: 'Suggested cards' }),
      ).toHaveAttribute('aria-expanded', 'false')
      expect(
        screen.queryByRole('list', { name: 'Suggested cards' }),
      ).not.toBeInTheDocument()
    })
  })
})
