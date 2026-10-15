import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { tagline } from '../App'
import type { Counts } from '../api/counts'
import type { Deck } from '../api/decks'
import { unreachableMessage } from '../api/flashCards'
import type { FlashCard, FlashCardFields, Tag } from '../api/flashCards'
import { defaultPreferences } from '../api/preferences'
import type { Preferences } from '../api/preferences'
import type { SystemDeck } from '../api/systemDecks'
import { setSession } from '../auth/session'
import { translateDelayMs } from '../hooks/useAutoTranslate'
import { tagSuggestDelayMs } from '../hooks/useTagSuggestions'
import { suggestionsCollapsedKey } from '../pages/CardSuggestions'
import { clearPreplyHandoff, startPreplyHandoff } from '../preply/preplyHandoff'
import { touchOnlyQuery } from '../pages/PreplyBookmarklet'
import { trackEvent, trackException } from '../telemetry'

vi.mock('../telemetry', () => ({
  trackEvent: vi.fn(),
  trackException: vi.fn(),
  trackPageView: vi.fn(),
}))

type Call = { url: string; init?: RequestInit }

const tagsUrl = 'http://localhost:5269/api/tags'
const decksUrl = 'http://localhost:5269/api/decks'
const suggestionsUrl = 'http://localhost:5269/api/card-suggestions'
const preferencesUrl = 'http://localhost:5269/api/preferences'
const tagSuggestionsUrl = 'http://localhost:5269/api/tag-suggestions'
const countsUrl = 'http://localhost:5269/api/counts'

// What loading the counts in the navigation gets, which a test can change. Null makes loading them fail.
let counts: Counts | null = { cards: 0, decks: 0, tags: 0 }

// The preferences loading them gets, which a test can change before the app renders. Null makes loading them fail.
let preferences: Preferences | null = defaultPreferences

// What asking for tag suggestions gets, which a test can change (by default, that they aren't available), and the
// cards they were asked for.
let suggestTags: () => Promise<Response>
let tagSuggestionRequests: FlashCardFields[] = []

// Answers every fetch with the handler, except that loading the tags or decks gets these, loading suggestions gets
// what suggest answers (by default, that they aren't available), and loading the preferences gets preferences. It
// keeps the calls, apart from the suggestions and loading the preferences, so a test can check what was sent.
function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  tags: Tag[] = [],
  decks: Deck[] = [],
  suggest: (url: string) => Promise<Response> = async () =>
    new Response(null, { status: 503 }),
) {
  const calls: Call[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.startsWith(suggestionsUrl)) {
        return suggest(url)
      }
      if (url === tagSuggestionsUrl) {
        tagSuggestionRequests.push(
          JSON.parse(init?.body as string) as FlashCardFields,
        )
        return suggestTags()
      }
      if (url === countsUrl) {
        return Promise.resolve(
          counts === null
            ? new Response(null, { status: 500 })
            : jsonResponse(counts),
        )
      }
      if (init?.method === undefined && url === preferencesUrl) {
        return Promise.resolve(
          preferences === null
            ? new Response(null, { status: 500 })
            : jsonResponse(preferences),
        )
      }
      calls.push({ url, init })
      if (init?.method === undefined && url === tagsUrl) {
        return Promise.resolve(jsonResponse(tags))
      }
      if (init?.method === undefined && url === decksUrl) {
        return Promise.resolve(jsonResponse(decks))
      }
      return handler(url, init)
    },
  )
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// fetch rejects like this when the API can't be reached at all.
function unreachable(): Promise<Response> {
  throw new TypeError('Failed to fetch')
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

// Renders the flash cards page with these cards and tags already loaded.
async function showCards(cards: FlashCard[], tags: Tag[] = []) {
  const calls = mockFetch(async (url, init) => {
    if (init?.method === undefined) {
      return jsonResponse(cards)
    }
    throw new Error(`Unexpected ${init.method} ${url}`)
  }, tags)
  renderAt('/')
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
  })
  return { calls }
}

// Signed in, since the app only shows the sign-in page otherwise. auth.test.tsx covers signing in and out.
beforeEach(() => {
  setSession({ token: 'test:Tester', name: 'Tester', provider: 'test' })
  preferences = defaultPreferences
  counts = { cards: 0, decks: 0, tags: 0 }
  suggestTags = async () => new Response(null, { status: 503 })
  tagSuggestionRequests = []
})

afterEach(() => {
  // Signing out re-renders the app if a test left it mounted.
  act(() => setSession(null))
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('App', () => {
  describe('static content', () => {
    it('renders the logo, tagline and the form', async () => {
      await showCards([])

      expect(
        screen.getByRole('heading', { level: 1, name: 'FlashCardSage' }),
      ).toBeInTheDocument()
      expect(screen.getByText(tagline)).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'FlashCardSage' }),
      ).toHaveAttribute('href', '/')
      expect(
        screen.getByRole('heading', { level: 2, name: 'Add flash card' }),
      ).toBeInTheDocument()
      expect(
        screen.getByLabelText('Spanish', { exact: false }),
      ).toBeInTheDocument()
      expect(
        screen.getByLabelText('English', { exact: false }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Add flash card' }),
      ).toBeInTheDocument()
    })

    it('shows the not found page for an unknown route', async () => {
      const calls = mockFetch(async () => jsonResponse([]))

      renderAt('/no/such/page')

      expect(
        await screen.findByRole('heading', {
          level: 2,
          name: 'Page not found',
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Go to flash cards' }),
      ).toHaveAttribute('href', '/')
      expect(calls).toEqual([])
    })
  })

  describe('loading the list', () => {
    it('shows a loading state, then the cards in order', async () => {
      mockFetch(async () =>
        jsonResponse([
          {
            id: 1,
            spanish: ['el gato'],
            english: ['the cat'],
            tags: [],
            imageUrl: null,
          },
          {
            id: 2,
            spanish: ['el perro'],
            english: ['the dog'],
            tags: [],
            imageUrl: null,
          },
        ]),
      )

      renderAt('/')

      expect(screen.getByLabelText('Loading')).toBeInTheDocument()
      const items = await screen.findAllByRole('listitem')
      expect(items.map((item) => item.textContent)).toEqual([
        'el gatothe catEditDelete',
        'el perrothe dogEditDelete',
      ])
      expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      expect(
        new Headers(
          (vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers,
        ).get('Authorization'),
      ).toBe('Bearer test:Tester')
    })

    it('says so when there are no cards', async () => {
      await showCards([])

      expect(screen.getByText('No flash cards yet.')).toBeInTheDocument()
    })

    it('shows an error when loading fails', async () => {
      mockFetch(async () => new Response(null, { status: 500 }))

      renderAt('/')

      expect(
        await screen.findByText('Unable to load flash cards.'),
      ).toBeInTheDocument()
      expect(screen.queryByText('No flash cards yet.')).not.toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'load',
      })
    })

    it('shows a retry message when the API is unreachable', async () => {
      mockFetch(unreachable)

      renderAt('/')

      expect(await screen.findByText(unreachableMessage)).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(TypeError), {
        operation: 'load',
      })
    })
  })

  describe('adding a card', () => {
    it('sends both trimmed sides, adds the card to the list and clears the inputs', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(async (_url, init) =>
        init?.method === 'POST'
          ? jsonResponse(
              {
                id: 7,
                spanish: ['el gato'],
                english: ['the cat'],
                tags: [],
                imageUrl: null,
              },
              201,
            )
          : jsonResponse([]),
      )
      renderAt('/')
      await screen.findByText('No flash cards yet.')

      await user.type(
        screen.getByLabelText('Spanish', { exact: false }),
        '  el gato  ',
      )
      await user.type(
        screen.getByLabelText('English', { exact: false }),
        ' the cat ',
      )
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(await screen.findByText('el gato')).toBeInTheDocument()
      expect(screen.getByText('the cat')).toBeInTheDocument()
      expect(screen.queryByText('No flash cards yet.')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Spanish', { exact: false })).toHaveValue('')
      expect(screen.getByLabelText('English', { exact: false })).toHaveValue('')
      const post = calls.find((call) => call.init?.method === 'POST')
      expect(post?.url).toBe('http://localhost:5269/api/flashcards')
      expect(post?.init?.body).toBe(
        JSON.stringify({
          spanish: ['el gato'],
          english: ['the cat'],
          tags: [],
        }),
      )
      expect(trackEvent).toHaveBeenCalledWith('FlashCardCreated')
    })

    it('sends every translation typed in, leaving out blank ones', async () => {
      const user = userEvent.setup()
      // Typing in a side asks for a translation too, which isn't answered.
      const isSave = (call: Call) =>
        call.init?.method === 'POST' && call.url.endsWith('/api/flashcards')
      const calls = mockFetch(async (url, init) =>
        isSave({ url, init })
          ? jsonResponse(
              {
                id: 7,
                spanish: ['solo', 'únicamente'],
                english: ['only'],
                tags: [],
                imageUrl: null,
              },
              201,
            )
          : jsonResponse([]),
      )
      renderAt('/')
      await screen.findByText('No flash cards yet.')

      await user.type(
        screen.getByLabelText('Spanish', { exact: false }),
        'solo',
      )
      await user.click(
        screen.getByRole('button', { name: 'Add Spanish translation' }),
      )
      expect(screen.getByLabelText('Spanish 2')).toHaveFocus()
      await user.type(screen.getByLabelText('Spanish 2'), ' únicamente ')
      await user.click(
        screen.getByRole('button', { name: 'Add Spanish translation' }),
      )
      await user.click(
        screen.getByRole('button', { name: 'Add English translation' }),
      )
      await user.click(screen.getByRole('button', { name: 'Remove English 2' }))
      expect(screen.queryByLabelText('English 2')).not.toBeInTheDocument()
      await user.type(
        screen.getByLabelText('English', { exact: false }),
        'only',
      )
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(await screen.findByText('solo / únicamente')).toBeInTheDocument()
      expect(screen.getByText('only')).toBeInTheDocument()
      // The form goes back to one field for each side.
      expect(screen.queryByLabelText('Spanish 2')).not.toBeInTheDocument()
      const post = calls.find(isSave)
      expect(post?.init?.body).toBe(
        JSON.stringify({
          spanish: ['solo', 'únicamente'],
          english: ['only'],
          tags: [],
        }),
      )
    })

    it('asks for the Spanish instead of sending a blank one', async () => {
      const user = userEvent.setup()
      const { calls } = await showCards([])
      const input = screen.getByLabelText('Spanish', { exact: false })
      // The field is required, so submit the form around it rather than clicking the button.
      input.removeAttribute('required')

      await user.type(input, '   ')
      await user.type(screen.getByLabelText('English', { exact: false }), 'x')
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Spanish is required.',
      )
      expect(calls.filter((call) => call.init?.method !== undefined)).toEqual(
        [],
      )
    })

    it('asks for the English instead of sending a blank one', async () => {
      const user = userEvent.setup()
      const { calls } = await showCards([])
      const input = screen.getByLabelText('English', { exact: false })
      input.removeAttribute('required')

      await user.type(screen.getByLabelText('Spanish', { exact: false }), 'x')
      await user.type(input, '   ')
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'English is required.',
      )
      expect(calls.filter((call) => call.init?.method !== undefined)).toEqual(
        [],
      )
    })

    it("shows the API's reason when it rejects the card", async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'POST'
          ? jsonResponse({ errors: { English: ['English is required.'] } }, 400)
          : jsonResponse([]),
      )
      renderAt('/')
      await screen.findByText('No flash cards yet.')

      await user.type(screen.getByLabelText('Spanish', { exact: false }), 'x')
      await user.type(screen.getByLabelText('English', { exact: false }), 'y')
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'English is required.',
      )
      expect(trackException).not.toHaveBeenCalled()
    })

    it('says so when the user already has a card for the word', async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'POST'
          ? jsonResponse(
              { detail: 'You already have a flash card with this Spanish.' },
              409,
            )
          : jsonResponse([
              { id: 1, spanish: ['el gato'], english: ['the cat'], tags: [] },
            ]),
      )
      renderAt('/')
      await screen.findByText('el gato')

      await user.type(
        screen.getByLabelText('Spanish', { exact: false }),
        'el gato',
      )
      await user.type(
        screen.getByLabelText('English', { exact: false }),
        'the tomcat',
      )
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'You already have a flash card with this Spanish.',
      )
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
      expect(screen.getByLabelText('Spanish', { exact: false })).toHaveValue(
        'el gato',
      )
      expect(trackException).not.toHaveBeenCalled()
    })

    it('shows an error when saving fails', async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'POST'
          ? new Response(null, { status: 500 })
          : jsonResponse([]),
      )
      renderAt('/')
      await screen.findByText('No flash cards yet.')

      await user.type(
        screen.getByLabelText('Spanish', { exact: false }),
        'el gato',
      )
      await user.type(
        screen.getByLabelText('English', { exact: false }),
        'the cat',
      )
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Unable to save flash card.',
      )
      expect(screen.getByLabelText('Spanish', { exact: false })).toHaveValue(
        'el gato',
      )
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'create',
      })
    })
  })

  describe('suggested cards', () => {
    const cat: FlashCard = {
      id: 1,
      spanish: ['el gato'],
      english: ['the cat'],
      tags: [],
      imageUrl: null,
    }

    // Renders the flash cards page with these cards, answering suggestions with suggest and a new card with save.
    async function showSuggestions(
      suggest: (url: string) => Promise<Response>,
      save: () => Promise<Response> = async () => {
        throw new Error('Unexpected POST')
      },
    ) {
      const calls = mockFetch(
        async (_url, init) =>
          init?.method === 'POST' ? save() : jsonResponse([cat]),
        [],
        [],
        suggest,
      )
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
      preferences = { ...defaultPreferences, showSuggestions: false }
      const suggest = vi.fn(async () =>
        jsonResponse([{ spanish: 'el perro', english: 'the dog' }]),
      )

      await showSuggestions(suggest)

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
        async () =>
          jsonResponse(
            {
              id: 2,
              spanish: ['el perro'],
              english: ['the dog'],
              tags: [],
              imageUrl: null,
            },
            201,
          ),
      )
      await screen.findByRole('list', { name: 'Suggested cards' })

      await user.click(screen.getByRole('button', { name: 'Add "el perro"' }))

      await waitFor(() => {
        expect(within(suggestionList()).getAllByRole('listitem')).toHaveLength(
          1,
        )
      })
      expect(suggestionList()).toHaveTextContent('el pez')
      expect(
        screen.getByRole('button', { name: 'Edit "el perro"' }),
      ).toBeInTheDocument()
      const post = calls.find((call) => call.init?.method === 'POST')
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
        async () =>
          jsonResponse(
            { detail: 'You already have a flash card with this English.' },
            409,
          ),
      )
      await screen.findByRole('list', { name: 'Suggested cards' })

      await user.click(screen.getByRole('button', { name: 'Add "el perro"' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'You already have a flash card with this English.',
      )
      expect(suggestionList()).toHaveTextContent('el perro')
      expect(trackException).not.toHaveBeenCalled()
    })

    it('asks for more suggestions', async () => {
      const user = userEvent.setup()
      const suggest = vi
        .fn<() => Promise<Response>>()
        .mockResolvedValueOnce(
          jsonResponse([{ spanish: 'el perro', english: 'the dog' }]),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ spanish: 'el pez', english: 'the fish' }]),
        )
      await showSuggestions(suggest)
      await screen.findByRole('list', { name: 'Suggested cards' })

      await user.click(screen.getByRole('button', { name: 'More suggestions' }))

      await waitFor(() => {
        expect(suggestionList()).toHaveTextContent('el pez')
      })
      expect(suggestionList()).not.toHaveTextContent('el perro')
      expect(suggest).toHaveBeenCalledTimes(2)
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
      await showSuggestions(suggest, async () =>
        jsonResponse(
          {
            id: 2,
            spanish: ['el perro'],
            english: ['the dog'],
            tags: [],
            imageUrl: null,
          },
          201,
        ),
      )
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
      expect(suggest).toHaveBeenLastCalledWith(`${suggestionsUrl}?relatedTo=2`)
    })

    describe('for a tag', () => {
      const food = { id: 5, name: 'Food' }
      const bread: FlashCard = {
        id: 3,
        spanish: ['el pan'],
        english: ['the bread'],
        tags: [food],
        imageUrl: null,
      }

      // Renders the page at path with the cat and the bread, answering suggestions with suggest and a new card with
      // the cheese.
      function showTagged(
        path: string,
        suggest: (url: string) => Promise<Response>,
      ) {
        const calls = mockFetch(
          async (_url, init) =>
            init?.method === 'POST'
              ? jsonResponse(
                  {
                    id: 4,
                    spanish: ['el queso'],
                    english: ['the cheese'],
                    tags: [food],
                    imageUrl: null,
                  },
                  201,
                )
              : jsonResponse([cat, bread]),
          [food],
          [],
          suggest,
        )
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
        expect(suggest).toHaveBeenLastCalledWith(`${suggestionsUrl}?tag=5`)
        expect(
          screen.getByText('New words and phrases for your “Food” cards.'),
        ).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Add "el queso"' }))

        expect(
          await screen.findByRole('button', { name: 'Edit "el queso"' }),
        ).toBeInTheDocument()
        const post = calls.find((call) => call.init?.method === 'POST')
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
          `${suggestionsUrl}?tag=5`,
        )
      })

      it('suggests cards under the tag of a card just added, not the picked one', async () => {
        const user = userEvent.setup()
        const seasons = { id: 6, name: 'Seasons' }
        const suggest = vi
          .fn<(url: string) => Promise<Response>>()
          .mockResolvedValueOnce(
            jsonResponse([{ spanish: 'el queso', english: 'the cheese' }]),
          )
          .mockResolvedValueOnce(
            jsonResponse([{ spanish: 'el verano', english: 'the summer' }]),
          )
        // The winter, added with the form, then the summer, added from the suggestions.
        const saved: FlashCard[] = [
          {
            id: 4,
            spanish: ['el invierno'],
            english: ['the winter'],
            tags: [seasons],
            imageUrl: null,
          },
          {
            id: 7,
            spanish: ['el verano'],
            english: ['the summer'],
            tags: [seasons],
            imageUrl: null,
          },
        ]
        const calls = mockFetch(
          async (_url, init) =>
            init?.method === 'POST'
              ? jsonResponse(saved.shift(), 201)
              : jsonResponse([cat, bread]),
          [food, seasons],
          [],
          suggest,
        )
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
          `${suggestionsUrl}?relatedTo=4&tag=6`,
        )
        expect(
          screen.getByText(
            'New “Seasons” words and phrases that go with “el invierno”.',
          ),
        ).toBeInTheDocument()

        await user.click(
          screen.getByRole('button', { name: 'Add "el verano"' }),
        )

        await waitFor(() => {
          expect(saved).toHaveLength(0)
        })
        const posts = calls.filter((call) => call.init?.method === 'POST')
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
        localStorage.removeItem(suggestionsCollapsedKey)
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
        expect(localStorage.getItem(suggestionsCollapsedKey)).toBe('true')

        await user.click(toggle)

        expect(toggle).toHaveAttribute('aria-expanded', 'true')
        expect(
          await screen.findByRole('list', { name: 'Suggested cards' }),
        ).toHaveTextContent('el perro')
        expect(localStorage.getItem(suggestionsCollapsedKey)).toBeNull()
      })

      it('starts collapsed when the user collapsed it before', async () => {
        localStorage.setItem(suggestionsCollapsedKey, 'true')
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

  describe('editing a card', () => {
    it('saves both changed sides', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? jsonResponse({
              id: 1,
              spanish: ['el perro'],
              english: ['the dog'],
              tags: [],
              imageUrl: null,
            })
          : jsonResponse([
              {
                id: 1,
                spanish: ['el gato'],
                english: ['the cat'],
                tags: [],
                imageUrl: null,
              },
              {
                id: 2,
                spanish: ['la casa'],
                english: ['the house'],
                tags: [],
                imageUrl: null,
              },
            ]),
      )
      renderAt('/')
      await screen.findByText('el gato')

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      const item = screen.getAllByRole('listitem')[0]
      const spanish = within(item).getByLabelText('Spanish')
      const english = within(item).getByLabelText('English')
      expect(spanish).toHaveValue('el gato')
      expect(spanish).toHaveFocus()
      expect(english).toHaveValue('the cat')
      await user.clear(spanish)
      await user.type(spanish, ' el perro ')
      await user.clear(english)
      await user.type(english, ' the dog ')
      await user.click(within(item).getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('el perro')).toBeInTheDocument()
      expect(screen.getByText('the dog')).toBeInTheDocument()
      expect(screen.queryByText('el gato')).not.toBeInTheDocument()
      expect(screen.getByText('la casa')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument()
      const put = calls.find((call) => call.init?.method === 'PUT')
      expect(put?.url).toBe('http://localhost:5269/api/flashcards/1')
      expect(put?.init?.body).toBe(
        JSON.stringify({
          spanish: ['el perro'],
          english: ['the dog'],
          tags: [],
        }),
      )
      expect(trackEvent).toHaveBeenCalledWith('FlashCardUpdated')
    })

    it('shows each translation in a field of its own, to change, add to and remove', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? jsonResponse({
              id: 1,
              spanish: ['únicamente', 'sólo'],
              english: ['only', 'just'],
              tags: [],
              imageUrl: null,
            })
          : jsonResponse([
              {
                id: 1,
                spanish: ['solo', 'únicamente'],
                english: ['only'],
                tags: [],
                imageUrl: null,
              },
            ]),
      )
      renderAt('/')
      expect(await screen.findByText('solo / únicamente')).toBeInTheDocument()

      await user.click(
        screen.getByRole('button', { name: 'Edit "solo / únicamente"' }),
      )
      const item = screen.getAllByRole('listitem')[0]
      expect(within(item).getByLabelText('Spanish')).toHaveValue('solo')
      expect(within(item).getByLabelText('Spanish 2')).toHaveValue('únicamente')
      expect(within(item).getByLabelText('English')).toHaveValue('only')
      expect(
        within(item).queryByRole('button', { name: 'Remove Spanish 1' }),
      ).not.toBeInTheDocument()

      await user.clear(within(item).getByLabelText('Spanish'))
      await user.type(within(item).getByLabelText('Spanish'), 'únicamente')
      await user.clear(within(item).getByLabelText('Spanish 2'))
      await user.type(within(item).getByLabelText('Spanish 2'), 'sólo')
      await user.click(
        within(item).getByRole('button', { name: 'Add English translation' }),
      )
      await user.type(within(item).getByLabelText('English 2'), 'just')
      await user.click(within(item).getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('únicamente / sólo')).toBeInTheDocument()
      expect(screen.getByText('only / just')).toBeInTheDocument()
      const put = calls.find((call) => call.init?.method === 'PUT')
      expect(put?.init?.body).toBe(
        JSON.stringify({
          spanish: ['únicamente', 'sólo'],
          english: ['only', 'just'],
          tags: [],
        }),
      )
    })

    it('can take a translation off a card', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? jsonResponse({
              id: 1,
              spanish: ['solo'],
              english: ['only'],
              tags: [],
              imageUrl: null,
            })
          : jsonResponse([
              {
                id: 1,
                spanish: ['solo', 'únicamente'],
                english: ['only'],
                tags: [],
                imageUrl: null,
              },
            ]),
      )
      renderAt('/')
      await screen.findByText('solo / únicamente')

      await user.click(
        screen.getByRole('button', { name: 'Edit "solo / únicamente"' }),
      )
      const item = screen.getAllByRole('listitem')[0]
      await user.click(
        within(item).getByRole('button', { name: 'Remove Spanish 2' }),
      )
      expect(within(item).queryByLabelText('Spanish 2')).not.toBeInTheDocument()
      await user.click(within(item).getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('solo')).toBeInTheDocument()
      const put = calls.find((call) => call.init?.method === 'PUT')
      expect(put?.init?.body).toBe(
        JSON.stringify({ spanish: ['solo'], english: ['only'], tags: [] }),
      )
    })

    it('can be cancelled, keeping the old card', async () => {
      const user = userEvent.setup()
      const { calls } = await showCards([
        {
          id: 1,
          spanish: ['el gato'],
          english: ['the cat'],
          tags: [],
          imageUrl: null,
        },
      ])

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      const input = screen.getByDisplayValue('el gato')
      await user.clear(input)
      await user.type(input, 'changed')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.getByText('el gato')).toBeInTheDocument()
      expect(screen.queryByText('changed')).not.toBeInTheDocument()
      expect(calls.filter((call) => call.init?.method !== undefined)).toEqual(
        [],
      )
    })

    it('asks for the English instead of saving a blank one', async () => {
      const user = userEvent.setup()
      const { calls } = await showCards([
        {
          id: 1,
          spanish: ['el gato'],
          english: ['the cat'],
          tags: [],
          imageUrl: null,
        },
      ])

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      await user.clear(screen.getByDisplayValue('the cat'))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'English is required.',
      )
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(calls.filter((call) => call.init?.method !== undefined)).toEqual(
        [],
      )
    })

    it('stays in edit mode when the change would duplicate another card', async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? jsonResponse(
              { detail: 'You already have a flash card with this English.' },
              409,
            )
          : jsonResponse([
              { id: 1, spanish: ['el gato'], english: ['the cat'], tags: [] },
              { id: 2, spanish: ['el perro'], english: ['the dog'], tags: [] },
            ]),
      )
      renderAt('/')
      await screen.findByText('el gato')

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      const item = screen.getAllByRole('listitem')[0]
      const english = within(item).getByLabelText('English')
      await user.clear(english)
      await user.type(english, 'the dog')
      await user.click(within(item).getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'You already have a flash card with this English.',
      )
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(trackException).not.toHaveBeenCalled()
    })

    it('shows an error and stays in edit mode when saving fails', async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? new Response(null, { status: 500 })
          : jsonResponse([
              {
                id: 1,
                spanish: ['el gato'],
                english: ['the cat'],
                tags: [],
                imageUrl: null,
              },
            ]),
      )
      renderAt('/')
      await screen.findByText('el gato')

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      await user.type(screen.getByDisplayValue('el gato'), 's')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Unable to save flash card.',
      )
      expect(screen.getByDisplayValue('el gatos')).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'update',
      })
    })
  })

  describe('auto translation', () => {
    // waitFor gives up after a second by default, which is about how long a translation waits for typing to stop.
    const untilTranslated = { timeout: translateDelayMs + 1000 }

    const autoTranslated = 'Auto-translated: edit to change'

    const dictionary: Record<string, string> = {
      'el gato': 'the cat',
      'the dog': 'el perro',
      'el perro': 'the dog',
    }

    // Answers translations with translate (by default from the dictionary, and a 503 for anything else), saves
    // cards as sent and lists cards.
    function mockTranslations(
      cards: FlashCard[] = [],
      translate: (text: string) => Promise<Response> = async (text) =>
        text in dictionary
          ? jsonResponse({ translation: dictionary[text] })
          : new Response(null, { status: 503 }),
    ) {
      const calls = mockFetch(async (url, init) => {
        const body =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, string>)
            : {}
        if (url.endsWith('/api/translations')) {
          return translate(body.text)
        }
        // These tests don't tag cards, so a saved card has no tags.
        if (init?.method === 'POST') {
          return jsonResponse({ id: 7, ...body, tags: [], imageUrl: null }, 201)
        }
        if (init?.method === 'PUT') {
          return jsonResponse({ id: 1, ...body, tags: [], imageUrl: null })
        }
        return jsonResponse(cards)
      })
      return () => calls.filter((call) => call.url.endsWith('/translations'))
    }

    // Long enough for a translation to have been sent, for checking that one wasn't.
    function waitPastTranslateDelay() {
      return new Promise((resolve) =>
        setTimeout(resolve, translateDelayMs + 200),
      )
    }

    async function showForm() {
      renderAt('/')
      await waitFor(() => {
        expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      })
      return {
        spanish: screen.getAllByLabelText('Spanish', { exact: false })[0],
        english: screen.getAllByLabelText('English', { exact: false })[0],
      }
    }

    it('fills in the English from the Spanish, once the user stops typing', async () => {
      const user = userEvent.setup()
      const translations = mockTranslations()
      const { spanish, english } = await showForm()

      await user.type(spanish, 'el gato')

      await waitFor(
        () => expect(english).toHaveValue('the cat'),
        untilTranslated,
      )
      expect(screen.getByText(autoTranslated)).toBeInTheDocument()
      expect(translations()).toHaveLength(1)
      expect(translations()[0].url).toBe(
        'http://localhost:5269/api/translations',
      )
      expect(translations()[0].init?.body).toBe(
        JSON.stringify({ text: 'el gato', from: 'Spanish' }),
      )

      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(await screen.findByText('the cat')).toBeInTheDocument()
      expect(english).toHaveValue('')
      expect(screen.queryByText(autoTranslated)).not.toBeInTheDocument()
    })

    it('fills in the Spanish from the English', async () => {
      const user = userEvent.setup()
      const translations = mockTranslations()
      const { spanish, english } = await showForm()

      await user.type(english, 'the dog')

      await waitFor(
        () => expect(spanish).toHaveValue('el perro'),
        untilTranslated,
      )
      expect(translations()[0].init?.body).toBe(
        JSON.stringify({ text: 'the dog', from: 'English' }),
      )
    })

    it('keeps what the user typed over a translation', async () => {
      const user = userEvent.setup()
      const translations = mockTranslations()
      const { spanish, english } = await showForm()
      await user.type(spanish, 'el gato')
      await waitFor(
        () => expect(english).toHaveValue('the cat'),
        untilTranslated,
      )

      await user.clear(english)
      await user.type(english, 'the kitty')
      await user.type(spanish, ' negro')
      await waitPastTranslateDelay()

      expect(english).toHaveValue('the kitty')
      expect(screen.queryByText(autoTranslated)).not.toBeInTheDocument()
      expect(translations()).toHaveLength(1)
    })

    it("doesn't overwrite what the user types while a translation is on its way", async () => {
      const user = userEvent.setup()
      let answer: (response: Response) => void = () => {}
      const translations = mockTranslations(
        [],
        () =>
          new Promise((resolve) => {
            answer = resolve
          }),
      )
      const { spanish, english } = await showForm()
      await user.type(spanish, 'el gato')
      await waitFor(
        () => expect(translations()).toHaveLength(1),
        untilTranslated,
      )
      expect(screen.getByText('Translating…')).toBeInTheDocument()

      await user.type(english, 'my cat')
      answer(jsonResponse({ translation: 'the cat' }))
      await waitPastTranslateDelay()

      expect(english).toHaveValue('my cat')
      expect(screen.queryByText('Translating…')).not.toBeInTheDocument()
    })

    it("offers a word's other meanings, and keeps the one the user picks", async () => {
      const user = userEvent.setup()
      mockTranslations([], async () =>
        jsonResponse({
          translation: 'silla',
          alternatives: ['cátedra', 'presidente'],
        }),
      )
      const { spanish, english } = await showForm()

      await user.type(english, 'chair')
      await waitFor(() => expect(spanish).toHaveValue('silla'), untilTranslated)
      expect(screen.getByText('Other meanings:')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'silla' }),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'presidente' }))

      expect(spanish).toHaveValue('presidente')
      expect(screen.queryByText(autoTranslated)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'silla' })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'presidente' }),
      ).not.toBeInTheDocument()

      await user.type(english, 's')
      await waitPastTranslateDelay()

      expect(spanish).toHaveValue('presidente')
      expect(screen.queryByText('Other meanings:')).not.toBeInTheDocument()
    })

    it('leaves a cleared side empty, and translates it again with its button', async () => {
      const user = userEvent.setup()
      const translations = mockTranslations()
      const { spanish, english } = await showForm()
      await user.type(spanish, 'el gato')
      await waitFor(
        () => expect(english).toHaveValue('the cat'),
        untilTranslated,
      )
      expect(
        screen.queryByRole('button', { name: 'Translate from Spanish' }),
      ).not.toBeInTheDocument()

      await user.clear(english)
      await waitPastTranslateDelay()
      expect(english).toHaveValue('')
      expect(translations()).toHaveLength(1)
      expect(
        screen.getByRole('button', { name: 'Translate from Spanish' }),
      ).toBeInTheDocument()

      await user.type(english, 'the kitty')
      await user.click(
        screen.getByRole('button', { name: 'Translate from Spanish' }),
      )

      await waitFor(() => expect(english).toHaveValue('the cat'))
      expect(screen.getByText(autoTranslated)).toBeInTheDocument()
      expect(translations()).toHaveLength(2)
      expect(translations()[1].init?.body).toBe(
        JSON.stringify({ text: 'el gato', from: 'Spanish' }),
      )
    })

    it('translates what the user typed over a translation the other way', async () => {
      const user = userEvent.setup()
      mockTranslations()
      const { spanish, english } = await showForm()
      await user.type(spanish, 'el gato')
      await waitFor(
        () => expect(english).toHaveValue('the cat'),
        untilTranslated,
      )

      await user.clear(english)
      await user.type(english, 'the dog')
      await user.click(
        screen.getByRole('button', { name: 'Translate from English' }),
      )

      await waitFor(() => expect(spanish).toHaveValue('el perro'))
      expect(english).toHaveValue('the dog')
      expect(screen.getByText(autoTranslated)).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /^Translate from/ }),
      ).not.toBeInTheDocument()
    })

    it('hands a side back to translation with its button', async () => {
      const user = userEvent.setup()
      mockTranslations([], async () =>
        jsonResponse({
          translation: 'silla',
          alternatives: ['cátedra', 'presidente'],
        }),
      )
      const { spanish, english } = await showForm()
      await user.type(english, 'chair')
      await waitFor(() => expect(spanish).toHaveValue('silla'), untilTranslated)
      await user.click(screen.getByRole('button', { name: 'presidente' }))

      await user.click(
        screen.getByRole('button', { name: 'Translate from English' }),
      )

      await waitFor(() => expect(spanish).toHaveValue('silla'))
      expect(screen.getByText(autoTranslated)).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Translate from English' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'presidente' }),
      ).toBeInTheDocument()
    })

    it("doesn't offer other meanings for a phrase", async () => {
      const user = userEvent.setup()
      mockTranslations()
      const { spanish, english } = await showForm()

      await user.type(spanish, 'el gato')

      await waitFor(
        () => expect(english).toHaveValue('the cat'),
        untilTranslated,
      )
      expect(screen.queryByText('Other meanings:')).not.toBeInTheDocument()
    })

    it('clears a translation when its side is cleared', async () => {
      const user = userEvent.setup()
      mockTranslations()
      const { spanish, english } = await showForm()
      await user.type(spanish, 'el gato')
      await waitFor(
        () => expect(english).toHaveValue('the cat'),
        untilTranslated,
      )

      await user.clear(spanish)

      expect(english).toHaveValue('')
      expect(screen.queryByText(autoTranslated)).not.toBeInTheDocument()
    })

    it('leaves the other side to the user when translation fails', async () => {
      const user = userEvent.setup()
      const translations = mockTranslations()
      const { spanish, english } = await showForm()

      await user.type(spanish, 'la casa')
      await waitFor(
        () => expect(translations()).toHaveLength(1),
        untilTranslated,
      )
      await waitPastTranslateDelay()

      expect(english).toHaveValue('')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByText('Translating…')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /^Translate from/ }),
      ).not.toBeInTheDocument()
    })

    it('leaves both sides to the user when they turned translation off', async () => {
      preferences = { ...defaultPreferences, autoTranslate: false }
      const user = userEvent.setup()
      const translations = mockTranslations()
      const { spanish, english } = await showForm()

      await user.type(spanish, 'el gato')
      await waitPastTranslateDelay()

      expect(translations()).toEqual([])
      expect(english).toHaveValue('')
      expect(screen.queryByText('Translating…')).not.toBeInTheDocument()

      await user.type(english, 'the kitty')
      await user.clear(spanish)
      await waitPastTranslateDelay()

      expect(translations()).toEqual([])
      expect(
        screen.queryByRole('button', { name: /^Translate from/ }),
      ).not.toBeInTheDocument()
    })

    it('translates a changed side of a card being edited', async () => {
      const user = userEvent.setup()
      const translations = mockTranslations([
        {
          id: 1,
          spanish: ['el gato'],
          english: ['the cat'],
          tags: [],
          imageUrl: null,
        },
      ])
      await showForm()

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      const item = screen.getAllByRole('listitem')[0]
      const spanish = within(item).getByLabelText('Spanish')
      const english = within(item).getByLabelText('English')
      await user.clear(spanish)
      await user.type(spanish, 'el perro')
      await waitFor(
        () => expect(english).toHaveValue('the dog'),
        untilTranslated,
      )
      await user.click(within(item).getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('the dog')).toBeInTheDocument()
      expect(translations()).toHaveLength(1)
    })

    it('translates a cleared side of a card being edited with its button', async () => {
      const user = userEvent.setup()
      const translations = mockTranslations([
        {
          id: 1,
          spanish: ['el gato'],
          english: ['a cat'],
          tags: [],
          imageUrl: null,
        },
      ])
      await showForm()

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      const item = screen.getAllByRole('listitem')[0]
      const english = within(item).getByLabelText('English')
      expect(
        within(item).queryByRole('button', { name: /^Translate from/ }),
      ).not.toBeInTheDocument()
      await user.clear(english)
      await user.click(
        within(item).getByRole('button', { name: 'Translate from Spanish' }),
      )

      await waitFor(() => expect(english).toHaveValue('the cat'))
      expect(translations()).toHaveLength(1)
    })
  })

  describe('deleting a card', () => {
    it('removes the card from the list', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(async (_url, init) =>
        init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : jsonResponse([
              {
                id: 1,
                spanish: ['el gato'],
                english: ['the cat'],
                tags: [],
                imageUrl: null,
              },
              {
                id: 2,
                spanish: ['la casa'],
                english: ['the house'],
                tags: [],
                imageUrl: null,
              },
            ]),
      )
      renderAt('/')
      await screen.findByText('el gato')

      await user.click(screen.getByRole('button', { name: 'Delete "el gato"' }))

      await waitFor(() => {
        expect(screen.queryByText('el gato')).not.toBeInTheDocument()
      })
      expect(screen.getByText('la casa')).toBeInTheDocument()
      expect(calls.find((call) => call.init?.method === 'DELETE')?.url).toBe(
        'http://localhost:5269/api/flashcards/1',
      )
      expect(trackEvent).toHaveBeenCalledWith('FlashCardDeleted')
    })

    it('says so when there are no cards left', async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : jsonResponse([
              {
                id: 1,
                spanish: ['el gato'],
                english: ['the cat'],
                tags: [],
                imageUrl: null,
              },
            ]),
      )
      renderAt('/')
      await screen.findByText('el gato')

      await user.click(screen.getByRole('button', { name: 'Delete "el gato"' }))

      expect(await screen.findByText('No flash cards yet.')).toBeInTheDocument()
    })

    it('shows an error and keeps the card when deleting fails', async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'DELETE'
          ? new Response(null, { status: 500 })
          : jsonResponse([
              {
                id: 1,
                spanish: ['el gato'],
                english: ['the cat'],
                tags: [],
                imageUrl: null,
              },
            ]),
      )
      renderAt('/')
      await screen.findByText('el gato')

      await user.click(screen.getByRole('button', { name: 'Delete "el gato"' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Unable to delete flash card.',
      )
      expect(screen.getByText('el gato')).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'delete',
      })
    })
  })

  describe('deleting the cards picked', () => {
    const threeCards = [
      {
        id: 1,
        spanish: ['el gato'],
        english: ['the cat'],
        tags: [{ id: 4, name: 'Pets' }],
        imageUrl: null,
      },
      {
        id: 2,
        spanish: ['el perro'],
        english: ['the dog'],
        tags: [{ id: 4, name: 'Pets' }],
        imageUrl: null,
      },
      {
        id: 3,
        spanish: ['la casa'],
        english: ['the house'],
        tags: [],
        imageUrl: null,
      },
    ]

    function mockCards(deleteResponse: () => Response) {
      return mockFetch(
        async (url, init) =>
          init?.method === 'POST' &&
          url === 'http://localhost:5269/api/flashcards/delete'
            ? deleteResponse()
            : jsonResponse(threeCards),
        [{ id: 4, name: 'Pets' }],
      )
    }

    it('deletes every card picked once the user says so', async () => {
      const user = userEvent.setup()
      const calls = mockCards(() => new Response(null, { status: 204 }))
      renderAt('/')
      await screen.findByText('el gato')

      expect(screen.getByRole('button', { name: 'Delete…' })).toBeDisabled()
      await user.click(screen.getByRole('checkbox', { name: 'Pick all 3' }))
      await user.click(screen.getByRole('button', { name: 'Delete 3 cards…' }))
      const dialog = await screen.findByRole('dialog', {
        name: 'Delete 3 cards?',
      })
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Deleted 3 cards.',
      )
      expect(screen.getByText('No flash cards yet.')).toBeInTheDocument()
      const post = calls.find((call) => call.init?.method === 'POST')
      expect(post?.init?.body).toBe(JSON.stringify({ flashCardIds: [1, 2, 3] }))
      expect(trackEvent).toHaveBeenCalledWith('FlashCardsDeleted')
    })

    it('deletes nothing when the user cancels', async () => {
      const user = userEvent.setup()
      const calls = mockCards(() => new Response(null, { status: 204 }))
      renderAt('/')
      await screen.findByText('el gato')

      await user.click(screen.getByRole('checkbox', { name: 'Pick "el gato"' }))
      await user.click(screen.getByRole('button', { name: 'Delete 1 card…' }))
      const dialog = await screen.findByRole('dialog', {
        name: 'Delete 1 card?',
      })
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      expect(calls.some((call) => call.init?.method === 'POST')).toBe(false)
      expect(screen.getByText('el gato')).toBeInTheDocument()
      expect(
        screen.getByRole('checkbox', { name: 'Pick "el gato"' }),
      ).toBeChecked()
    })

    it("only deletes the picked tag's cards", async () => {
      const user = userEvent.setup()
      const calls = mockCards(() => new Response(null, { status: 204 }))
      renderAt('/')
      await screen.findByText('el gato')

      await user.click(screen.getByRole('checkbox', { name: 'Pick "la casa"' }))
      await user.click(
        within(
          screen.getByRole('group', { name: 'Show cards tagged' }),
        ).getByRole('button', { name: 'Pets (2)' }),
      )
      await user.click(screen.getByRole('checkbox', { name: 'Pick all 2' }))
      await user.click(screen.getByRole('button', { name: 'Delete 2 cards…' }))
      await user.click(
        within(
          await screen.findByRole('dialog', { name: 'Delete 2 cards?' }),
        ).getByRole('button', { name: 'Delete' }),
      )

      await screen.findByRole('status')
      expect(
        calls.find((call) => call.init?.method === 'POST')?.init?.body,
      ).toBe(JSON.stringify({ flashCardIds: [1, 2] }))
    })

    it('keeps the cards and says why when deleting fails', async () => {
      const user = userEvent.setup()
      mockCards(() => new Response(null, { status: 500 }))
      renderAt('/')
      await screen.findByText('el gato')

      await user.click(screen.getByRole('checkbox', { name: 'Pick "el gato"' }))
      await user.click(screen.getByRole('button', { name: 'Delete 1 card…' }))
      await user.click(
        within(
          await screen.findByRole('dialog', { name: 'Delete 1 card?' }),
        ).getByRole('button', { name: 'Delete' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Unable to delete the flash cards.',
      )
      expect(screen.getByText('el gato')).toBeInTheDocument()
      expect(
        screen.getByRole('checkbox', { name: 'Pick "el gato"' }),
      ).toBeChecked()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'deleteMany',
      })
    })
  })

  describe('tags', () => {
    const food = { id: 1, name: 'Food' }
    const travel = { id: 2, name: 'Travel' }
    const apple = {
      id: 1,
      spanish: ['la manzana'],
      english: ['the apple'],
      tags: [food],
      imageUrl: null,
    }
    const train = {
      id: 2,
      spanish: ['el tren'],
      english: ['the train'],
      tags: [travel],
      imageUrl: null,
    }

    it("shows each card's tags and only the picked tag's cards", async () => {
      const user = userEvent.setup()
      await showCards([apple, train], [food, travel])

      const filter = screen.getByRole('group', { name: 'Show cards tagged' })
      expect(
        within(filter)
          .getAllByRole('button')
          .map((chip) => chip.textContent),
      ).toEqual(['All (2)', 'Food (1)', 'Travel (1)'])
      expect(
        within(screen.getAllByRole('listitem')[0]).getByText('Food'),
      ).toBeInTheDocument()

      await user.click(
        within(filter).getByRole('button', { name: 'Travel (1)' }),
      )

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
      await showCards([apple], [food, travel])

      await user.click(screen.getByRole('button', { name: 'Travel (0)' }))

      expect(
        screen.getByText('No flash cards with this tag.'),
      ).toBeInTheDocument()
    })

    it('sends the tags typed in for a new card and adds new ones to the list', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(
        async (_url, init) =>
          init?.method === 'POST'
            ? jsonResponse(
                {
                  id: 3,
                  spanish: ['el pan'],
                  english: ['the bread'],
                  tags: [{ id: 3, name: 'Bakery' }, food],
                },
                201,
              )
            : jsonResponse([apple]),
        [food],
      )
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
      const post = calls.find((call) => call.init?.method === 'POST')
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
      expect(
        screen.getByRole('button', { name: 'Food (2)' }),
      ).toBeInTheDocument()
    })

    it("changes a card's tags", async () => {
      const user = userEvent.setup()
      const calls = mockFetch(
        async (_url, init) =>
          init?.method === 'PUT'
            ? jsonResponse({ ...apple, tags: [food, travel] })
            : jsonResponse([apple]),
        [food, travel],
      )
      renderAt('/')
      await screen.findByText('la manzana')

      await user.click(
        screen.getByRole('button', { name: 'Edit "la manzana"' }),
      )
      const item = screen.getAllByRole('listitem')[0]
      expect(
        within(item).getByRole('button', { name: 'Food' }),
      ).toBeInTheDocument()
      await user.type(within(item).getByLabelText('Tags'), 'Travel{Enter}')
      await user.click(within(item).getByRole('button', { name: 'Save' }))

      expect(
        await screen.findByRole('button', { name: 'Travel (1)' }),
      ).toBeInTheDocument()
      const put = calls.find((call) => call.init?.method === 'PUT')
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

      // Long enough for suggestions to have been asked for, for checking that they weren't.
      function waitPastSuggestDelay() {
        return new Promise((resolve) =>
          setTimeout(resolve, tagSuggestDelayMs + 200),
        )
      }

      // These tests type one side of a card, so it isn't translated.
      beforeEach(() => {
        preferences = { ...defaultPreferences, autoTranslate: false }
      })

      it('suggests tags for a new card, and adds the one the user clicks', async () => {
        const user = userEvent.setup()
        suggestTags = async () => jsonResponse([food])
        const calls = mockFetch(
          async (_url, init) =>
            init?.method === 'POST'
              ? jsonResponse(
                  { ...train, id: 3, spanish: ['el pan'], tags: [food] },
                  201,
                )
              : jsonResponse([apple, train]),
          [food, travel],
        )
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
        expect(tagSuggestionRequests).toEqual([
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
          const sent = calls.find((call) => call.init?.method === 'POST')
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
        suggestTags = async () => jsonResponse([food, travel])
        const calls = mockFetch(
          async (_url, init) =>
            init?.method === 'PUT'
              ? jsonResponse({ ...apple, tags: [food, travel] })
              : jsonResponse([apple]),
          [food, travel],
        )
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
        expect(tagSuggestionRequests).toEqual([
          { spanish: ['la manzana'], english: ['the apple'], tags: ['Food'] },
        ])
        const put = calls.find((call) => call.init?.method === 'PUT')
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
        suggestTags = async () => jsonResponse([food])
        await showCards([apple], [food])
        const spanish = screen.getByLabelText('Spanish', { exact: false })
        await user.type(spanish, 'el pan')
        await screen.findByText('Suggested tags:', {}, untilSuggested)

        suggestTags = async () => jsonResponse([])
        await user.type(spanish, 'adero')

        expect(screen.queryByText('Suggested tags:')).not.toBeInTheDocument()
        await waitFor(
          () => expect(tagSuggestionRequests).toHaveLength(2),
          untilSuggested,
        )
        expect(tagSuggestionRequests[1].spanish).toEqual(['el panadero'])
        expect(screen.queryByText('Suggested tags:')).not.toBeInTheDocument()
      })

      it("doesn't ask once they aren't available", async () => {
        const user = userEvent.setup()
        await showCards([apple], [food])
        const spanish = screen.getByLabelText('Spanish', { exact: false })
        await user.type(spanish, 'el pan')
        await waitFor(
          () => expect(tagSuggestionRequests).toHaveLength(1),
          untilSuggested,
        )

        await user.type(spanish, 'adero')
        await waitPastSuggestDelay()

        expect(tagSuggestionRequests).toHaveLength(1)
        expect(screen.queryByText('Suggested tags:')).not.toBeInTheDocument()
      })

      it("doesn't ask when the user has no tags", async () => {
        const user = userEvent.setup()
        suggestTags = async () => jsonResponse([food])
        await showCards([])

        await user.type(
          screen.getByLabelText('Spanish', { exact: false }),
          'el pan',
        )
        await waitPastSuggestDelay()

        expect(tagSuggestionRequests).toEqual([])
      })

      it("doesn't ask when the user turned suggestions off", async () => {
        const user = userEvent.setup()
        preferences = {
          ...defaultPreferences,
          autoTranslate: false,
          showSuggestions: false,
        }
        suggestTags = async () => jsonResponse([food])
        await showCards([apple], [food])

        await user.type(
          screen.getByLabelText('Spanish', { exact: false }),
          'el pan',
        )
        await waitPastSuggestDelay()

        expect(tagSuggestionRequests).toEqual([])
      })
    })

    describe('the Tags page', () => {
      const pear: FlashCard = {
        id: 3,
        spanish: ['la pera'],
        english: ['the pear'],
        tags: [food],
        imageUrl: null,
      }

      // Renders the Tags page, answering each change with the handler.
      async function showTags(
        handler: (url: string, init?: RequestInit) => Promise<Response> = (
          url,
          init,
        ) => {
          throw new Error(`Unexpected ${init?.method} ${url}`)
        },
      ) {
        const calls = mockFetch(
          async (url, init) =>
            init?.method === undefined
              ? jsonResponse([apple, train, pear])
              : handler(url, init),
          [food, travel],
        )
        renderAt('/tags')
        await screen.findByRole('link', { name: 'Food' })
        return calls
      }

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
        const calls = await showTags(async () =>
          jsonResponse({ id: 1, name: 'Groceries' }),
        )

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
        const put = calls.find((call) => call.init?.method === 'PUT')
        expect(put?.url).toBe(`${tagsUrl}/1`)
        expect(put?.init?.body).toBe(JSON.stringify({ name: 'Groceries' }))
        expect(trackEvent).toHaveBeenCalledWith('TagRenamed')
      })

      it("shows the API's reason when it rejects a new name", async () => {
        const user = userEvent.setup()
        await showTags(async () =>
          jsonResponse(
            { errors: { Name: ["There's already a tag with that name."] } },
            400,
          ),
        )

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
        const calls = await showTags(
          async () => new Response(null, { status: 204 }),
        )

        await screen.findByRole('link', { name: 'Tags 0' })
        counts = { cards: 0, decks: 0, tags: 1 }

        await user.click(
          screen.getByRole('button', { name: 'Delete tag "Food"' }),
        )

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
        expect(calls.find((call) => call.init?.method === 'DELETE')?.url).toBe(
          `${tagsUrl}/1`,
        )
        expect(trackEvent).toHaveBeenCalledWith('TagDeleted')
      })

      it('creates a tag with no cards', async () => {
        const user = userEvent.setup()
        const calls = await showTags(async () =>
          jsonResponse({ id: 5, name: 'Animals' }, 201),
        )

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
        const post = calls.find((call) => call.init?.method === 'POST')
        expect(post?.url).toBe(tagsUrl)
        expect(post?.init?.body).toBe(JSON.stringify({ name: 'Animals' }))
        expect(trackEvent).toHaveBeenCalledWith('TagCreated')
      })

      it("shows the API's reason when it rejects a new tag", async () => {
        const user = userEvent.setup()
        await showTags(async () =>
          jsonResponse(
            { errors: { Name: ["There's already a tag with that name."] } },
            400,
          ),
        )

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
        mockFetch(async () => jsonResponse([]))
        renderAt('/tags')

        expect(
          await screen.findByText(/You haven't made any tags yet\./),
        ).toBeInTheDocument()
      })

      it("leaves renaming and deleting to the Tags page, so the cards page's chips only filter", async () => {
        const user = userEvent.setup()
        mockFetch(async () => jsonResponse([apple, train]), [food, travel])
        renderAt('/')
        await screen.findByText('la manzana')

        await user.click(screen.getByRole('button', { name: 'Food (1)' }))

        expect(
          screen.queryByRole('button', { name: /^(Rename|Delete) tag/ }),
        ).not.toBeInTheDocument()
      })
    })

    it('shows every card when the tag in the address no longer exists', async () => {
      mockFetch(async () => jsonResponse([apple, train]), [food])

      renderAt('/?tag=99')

      expect(await screen.findAllByRole('listitem')).toHaveLength(2)
      expect(screen.getByRole('button', { name: 'All (2)' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    it('starts with the tag in the address picked', async () => {
      mockFetch(async () => jsonResponse([apple, train]), [food, travel])

      renderAt('/?tag=2')

      expect(await screen.findAllByRole('listitem')).toHaveLength(1)
      expect(screen.getByText('el tren')).toBeInTheDocument()
    })
  })

  describe('pictures', () => {
    const picture = { contentType: 'image/png', data: 'iVBORw0KGgo=' }
    const generateUrl = 'http://localhost:5269/api/flashcards/images/generate'
    const imageUrl = 'http://images.test/7.png'
    const gato = {
      id: 7,
      spanish: ['el gato'],
      english: ['the cat'],
      tags: [],
      imageUrl: null,
    }

    // Answers a request for a picture as told, and saves a card and its picture as the API would. Translation is
    // off, as it is locally.
    function mockPictures({
      generate = () => jsonResponse(picture),
      putStatus = 200,
      cards = [] as FlashCard[],
    } = {}) {
      return mockFetch(async (url, init) => {
        if (url === generateUrl) {
          return generate()
        }
        if (url.endsWith('/api/translations')) {
          return new Response(null, { status: 503 })
        }
        if (init?.method === 'POST') {
          return jsonResponse(gato, 201)
        }
        if (url.endsWith('/image')) {
          return putStatus === 200
            ? jsonResponse({
                ...gato,
                imageUrl: init?.method === 'PUT' ? imageUrl : null,
              })
            : new Response(null, { status: putStatus })
        }
        if (init?.method === 'PUT') {
          return jsonResponse({ ...cards[0], spanish: ['el gatos'] })
        }
        return jsonResponse(cards)
      })
    }

    // Types the Spanish of a new card and asks for a picture of it.
    async function generatePicture(user: ReturnType<typeof userEvent.setup>) {
      await user.type(
        screen.getByLabelText('Spanish', { exact: false }),
        'el gato',
      )
      await user.click(screen.getByRole('button', { name: 'Generate picture' }))
      return await screen.findByRole('img', { name: 'Generated picture' })
    }

    it('offers a picture of the words, which the user can discard before saving', async () => {
      const user = userEvent.setup()
      const calls = mockPictures()
      renderAt('/')
      await screen.findByText('No flash cards yet.')
      expect(
        screen.getByRole('button', { name: 'Generate picture' }),
      ).toBeDisabled()

      const preview = await generatePicture(user)

      expect(preview).toHaveAttribute(
        'src',
        'data:image/png;base64,iVBORw0KGgo=',
      )
      const generate = calls.find((call) => call.url === generateUrl)
      expect(generate?.init?.method).toBe('POST')
      expect(generate?.init?.body).toBe(
        JSON.stringify({ spanish: 'el gato', english: '' }),
      )
      expect(trackEvent).toHaveBeenCalledWith('FlashCardImageGenerated')

      await user.click(screen.getByRole('button', { name: 'Discard' }))

      await user.type(
        screen.getByLabelText('English', { exact: false }),
        'the cat',
      )
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(await screen.findByText('el gato')).toBeInTheDocument()
      expect(
        screen.queryByRole('img', { name: 'Generated picture' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('img', { name: 'Picture for "el gato"' }),
      ).not.toBeInTheDocument()
      expect(calls.some((call) => call.url.endsWith('/image'))).toBe(false)
    })

    it("puts the picture on the card when it's saved", async () => {
      const user = userEvent.setup()
      const calls = mockPictures()
      renderAt('/')
      await screen.findByText('No flash cards yet.')
      await generatePicture(user)

      await user.type(
        screen.getByLabelText('English', { exact: false }),
        'the cat',
      )
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(
        await screen.findByRole('img', { name: 'Picture for "el gato"' }),
      ).toHaveAttribute('src', imageUrl)
      const put = calls.find((call) => call.init?.method === 'PUT')
      expect(put?.url).toBe('http://localhost:5269/api/flashcards/7/image')
      expect(put?.init?.body).toBe(JSON.stringify(picture))
      expect(
        screen.queryByRole('img', { name: 'Generated picture' }),
      ).not.toBeInTheDocument()
      expect(trackEvent).toHaveBeenCalledWith('FlashCardImageAdded')
    })

    it('can discard the picture and ask for another', async () => {
      const user = userEvent.setup()
      const calls = mockPictures()
      renderAt('/')
      await screen.findByText('No flash cards yet.')
      await generatePicture(user)

      await user.click(screen.getByRole('button', { name: 'Discard' }))

      expect(
        screen.queryByRole('img', { name: 'Generated picture' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Generate picture' }),
      ).toBeEnabled()

      await user.click(screen.getByRole('button', { name: 'Generate picture' }))

      expect(
        await screen.findByRole('img', { name: 'Generated picture' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Generate another picture' }),
      ).toBeInTheDocument()
      expect(calls.filter((call) => call.url === generateUrl)).toHaveLength(2)
    })

    it.each([
      [503, "Pictures aren't available."],
      [422, "That card can't be illustrated. Try other words."],
      [502, 'Unable to make a picture.'],
    ])(
      'says why when the API answers %i instead of a picture',
      async (status, message) => {
        const user = userEvent.setup()
        mockPictures({ generate: () => new Response(null, { status }) })
        renderAt('/')
        await screen.findByText('No flash cards yet.')

        await user.type(
          screen.getByLabelText('Spanish', { exact: false }),
          'el gato',
        )
        await user.click(
          screen.getByRole('button', { name: 'Generate picture' }),
        )

        expect(await screen.findByText(message)).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(
          screen.queryByRole('img', { name: 'Generated picture' }),
        ).not.toBeInTheDocument()
      },
    )

    it("keeps the card when its picture can't be added", async () => {
      const user = userEvent.setup()
      mockPictures({ putStatus: 500 })
      renderAt('/')
      await screen.findByText('No flash cards yet.')
      await generatePicture(user)
      await user.type(
        screen.getByLabelText('English', { exact: false }),
        'the cat',
      )

      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Flash card saved, but the picture couldn't be added.",
      )
      expect(screen.getByText('el gato')).toBeInTheDocument()
      expect(
        screen.queryByRole('img', { name: /^Picture for/ }),
      ).not.toBeInTheDocument()
      expect(screen.getByLabelText('Spanish', { exact: false })).toHaveValue('')
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'picture',
      })
    })

    it("shows each card's picture, and takes it off when the user removes it", async () => {
      const user = userEvent.setup()
      const calls = mockPictures({ cards: [{ ...gato, imageUrl }] })
      renderAt('/')
      expect(
        await screen.findByRole('img', { name: 'Picture for "el gato"' }),
      ).toHaveAttribute('src', imageUrl)

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      const item = screen.getByRole('listitem')
      expect(
        within(item).getByRole('img', { name: "The card's picture" }),
      ).toHaveAttribute('src', imageUrl)
      await user.click(
        within(item).getByRole('button', { name: 'Remove picture' }),
      )
      expect(
        within(item).queryByRole('img', { name: "The card's picture" }),
      ).not.toBeInTheDocument()
      await user.click(within(item).getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Save' }),
        ).not.toBeInTheDocument()
      })
      expect(screen.getByText('el gato')).toBeInTheDocument()
      expect(
        screen.queryByRole('img', { name: /^Picture for/ }),
      ).not.toBeInTheDocument()
      expect(
        calls
          .filter((call) => call.init?.method !== undefined)
          .map((call) => `${call.init?.method} ${call.url}`),
      ).toEqual([
        'PUT http://localhost:5269/api/flashcards/7',
        'DELETE http://localhost:5269/api/flashcards/7/image',
      ])
      expect(trackEvent).toHaveBeenCalledWith('FlashCardImageRemoved')
    })

    it("shows a new picture in place of the card's, and puts it on the card when it's saved", async () => {
      const user = userEvent.setup()
      const calls = mockPictures({ cards: [{ ...gato, imageUrl }] })
      renderAt('/')
      await screen.findByRole('img', { name: 'Picture for "el gato"' })

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      const item = screen.getByRole('listitem')
      await user.click(
        within(item).getByRole('button', { name: 'Generate another picture' }),
      )

      expect(
        await within(item).findByRole('img', { name: 'Generated picture' }),
      ).toBeInTheDocument()
      expect(
        within(item).queryByRole('img', { name: "The card's picture" }),
      ).not.toBeInTheDocument()
      expect(
        within(item).queryByRole('button', { name: 'Remove picture' }),
      ).not.toBeInTheDocument()

      // Discarding it brings the card's own back.
      await user.click(within(item).getByRole('button', { name: 'Discard' }))
      expect(
        within(item).getByRole('img', { name: "The card's picture" }),
      ).toHaveAttribute('src', imageUrl)

      await user.click(
        within(item).getByRole('button', { name: 'Generate another picture' }),
      )
      await within(item).findByRole('img', { name: 'Generated picture' })
      await user.click(within(item).getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Save' }),
        ).not.toBeInTheDocument()
      })
      const put = calls.find(
        (call) => call.init?.method === 'PUT' && call.url.endsWith('/image'),
      )
      expect(put?.init?.body).toBe(JSON.stringify(picture))
      expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(false)
    })

    it('keeps the picture when the edit is cancelled', async () => {
      const user = userEvent.setup()
      const calls = mockPictures({ cards: [{ ...gato, imageUrl }] })
      renderAt('/')
      await screen.findByRole('img', { name: 'Picture for "el gato"' })

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      await user.click(screen.getByRole('button', { name: 'Remove picture' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(
        screen.getByRole('img', { name: 'Picture for "el gato"' }),
      ).toHaveAttribute('src', imageUrl)
      // Only the page's loads: cancelling sends nothing.
      expect(calls.filter((call) => call.init?.method !== undefined)).toEqual(
        [],
      )

      // The next edit starts over with the picture still there.
      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      expect(
        screen.getByRole('img', { name: "The card's picture" }),
      ).toBeInTheDocument()
    })

    it('neither shows pictures nor offers one when the user turned pictures off', async () => {
      preferences = { ...defaultPreferences, showPictures: false }
      const user = userEvent.setup()
      const calls = mockPictures({ cards: [{ ...gato, imageUrl }] })
      renderAt('/')
      await screen.findByText('el gato')

      expect(
        screen.queryByRole('img', { name: /picture/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Generate picture' }),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      expect(
        screen.queryByRole('img', { name: /picture/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /picture/ }),
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Save' }))

      // The card keeps its picture.
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Save' }),
        ).not.toBeInTheDocument()
      })
      expect(
        calls
          .filter((call) => call.init?.method !== undefined)
          .map((call) => `${call.init?.method} ${call.url}`),
      ).toEqual(['PUT http://localhost:5269/api/flashcards/7'])
    })
  })

  describe('decks', () => {
    const pets: Tag = { id: 4, name: 'Pets' }
    const cat: FlashCard = {
      id: 1,
      spanish: ['el gato'],
      english: ['the cat'],
      tags: [pets],
      imageUrl: null,
    }
    const dog: FlashCard = {
      id: 2,
      spanish: ['el perro'],
      english: ['the dog'],
      tags: [pets],
      imageUrl: null,
    }
    const house: FlashCard = {
      id: 3,
      spanish: ['la casa'],
      english: ['the house'],
      tags: [],
      imageUrl: null,
    }
    const song: FlashCard = {
      id: 4,
      spanish: ['la canción'],
      english: ['the song'],
      tags: [],
      imageUrl: null,
    }
    const cards = [cat, dog, house, song]
    const animals: Deck = { id: 7, name: 'Animals', flashCardIds: [1, 2] }

    // Answers loading the cards and a deck, and every change with the handler.
    function mockDeckApi(
      deck: Deck | null,
      handler: (url: string, init?: RequestInit) => Promise<Response> = (
        url,
        init,
      ) => {
        throw new Error(`Unexpected ${init?.method} ${url}`)
      },
      allCards: FlashCard[] = cards,
    ) {
      return mockFetch(
        async (url, init) => {
          if (init?.method !== undefined) {
            return handler(url, init)
          }
          if (url.startsWith(`${decksUrl}/`)) {
            return deck === null
              ? new Response(null, { status: 404 })
              : jsonResponse(deck)
          }
          return jsonResponse(allCards)
        },
        [pets],
        deck === null ? [] : [deck],
      )
    }

    async function showPage(path: string) {
      renderAt(path)
      await waitFor(() => {
        expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      })
    }

    // The card checkboxes in the tab shown, by their Spanish.
    function cardBox(spanish: string) {
      return screen.getByRole('checkbox', { name: `Pick "${spanish}"` })
    }

    describe('the list', () => {
      it('lists the decks with how many cards each has', async () => {
        mockFetch(
          async () => jsonResponse([]),
          [],
          [animals, { id: 8, name: 'Home', flashCardIds: [3] }],
        )
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
        mockFetch(async () => jsonResponse([]))
        await showPage('/decks')

        expect(
          screen.getByText("You haven't made any decks yet."),
        ).toBeInTheDocument()
      })

      it('creates a deck and opens it on adding cards', async () => {
        const user = userEvent.setup()
        const created: Deck = { id: 9, name: 'Week 1', flashCardIds: [] }
        const calls = mockDeckApi(created, async () =>
          jsonResponse(created, 201),
        )
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
        const post = calls.find((call) => call.init?.method === 'POST')
        expect(post?.url).toBe(decksUrl)
        expect(post?.init?.body).toBe(
          JSON.stringify({ name: 'Week 1', flashCardIds: [] }),
        )
        expect(trackEvent).toHaveBeenCalledWith('DeckCreated')
      })

      it('shows why the API refused a deck', async () => {
        const user = userEvent.setup()
        mockDeckApi(animals, async () =>
          jsonResponse(
            { errors: { Name: ["There's already a deck with that name."] } },
            400,
          ),
        )
        await showPage('/decks')

        await user.type(
          screen.getByLabelText('Deck name', { exact: false }),
          'animals',
        )
        await user.click(screen.getByRole('button', { name: 'Create deck' }))

        expect(await screen.findByRole('alert')).toHaveTextContent(
          "There's already a deck with that name.",
        )
        expect(
          screen.getByLabelText('Deck name', { exact: false }),
        ).toHaveValue('animals')
        expect(trackException).not.toHaveBeenCalled()
      })

      it('deletes a deck', async () => {
        const user = userEvent.setup()
        const calls = mockDeckApi(
          animals,
          async () => new Response(null, { status: 204 }),
        )
        await showPage('/decks')

        await user.click(
          screen.getByRole('button', { name: 'Delete deck "Animals"' }),
        )

        expect(
          await screen.findByText("You haven't made any decks yet."),
        ).toBeInTheDocument()
        const del = calls.find((call) => call.init?.method === 'DELETE')
        expect(del?.url).toBe(`${decksUrl}/7`)
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
          { ...cat, imageUrl: 'http://images.test/1.png' },
          dog,
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
        expect(
          screen.getAllByRole('checkbox', { name: /^Pick "/ }),
        ).toHaveLength(1)

        await user.clear(screen.getByRole('searchbox', { name: 'Search' }))
        await user.type(
          screen.getByRole('searchbox', { name: 'Search' }),
          'the dog',
        )

        expect(
          screen.getAllByRole('checkbox', { name: /^Pick "/ }),
        ).toHaveLength(1)
        expect(cardBox('el perro')).toBeInTheDocument()
      })

      it('adds every card with a tag, and stays on adding cards', async () => {
        const user = userEvent.setup()
        const calls = mockDeckApi({ ...animals, flashCardIds: [3] }, async () =>
          jsonResponse({ ...animals, flashCardIds: [1, 2, 3] }),
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
        const patch = calls.find((call) => call.init?.method === 'PATCH')
        expect(patch?.url).toBe(`${decksUrl}/7/cards`)
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
        const calls = mockDeckApi(animals, async () =>
          jsonResponse({ ...animals, flashCardIds: [2] }),
        )
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
        const patch = calls.find((call) => call.init?.method === 'PATCH')
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
        const calls = mockDeckApi(
          animals,
          async () => new Response(null, { status: 204 }),
        )
        await showPage('/decks/7')

        await user.click(
          screen.getByRole('button', { name: 'Delete "el gato"' }),
        )

        expect(await screen.findByRole('status')).toHaveTextContent(
          'Deleted 1 card.',
        )
        const post = calls.find((call) => call.init?.method === 'POST')
        expect(post?.url).toBe('http://localhost:5269/api/flashcards/delete')
        expect(post?.init?.body).toBe(JSON.stringify({ flashCardIds: [1] }))
        expect(calls.some((call) => call.init?.method === 'PATCH')).toBe(false)
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
        const calls = mockDeckApi(animals, async () =>
          jsonResponse({ ...animals, flashCardIds: [2] }),
        )
        await showPage('/decks/7')

        await user.click(
          screen.getByRole('button', {
            name: 'Remove "el gato" from deck',
          }),
        )

        expect(await screen.findByRole('status')).toHaveTextContent(
          'Removed 1 card from the deck.',
        )
        const patch = calls.find((call) => call.init?.method === 'PATCH')
        expect(patch?.init?.body).toBe(JSON.stringify({ add: [], remove: [1] }))
        expect(calls.some((call) => call.init?.method === 'POST')).toBe(false)
        // It's still a card, so it can be added back.
        expect(
          screen.getByRole('tab', { name: 'Add cards (3)' }),
        ).toBeInTheDocument()
      })

      it('deletes the cards picked once the user says so', async () => {
        const user = userEvent.setup()
        const calls = mockDeckApi(
          animals,
          async () => new Response(null, { status: 204 }),
        )
        await showPage('/decks/7')

        expect(screen.getByRole('button', { name: 'Delete…' })).toBeDisabled()
        await user.click(screen.getByRole('checkbox', { name: 'Pick all 2' }))
        await user.click(
          screen.getByRole('button', { name: 'Delete 2 cards…' }),
        )
        await user.click(
          within(
            await screen.findByRole('dialog', { name: 'Delete 2 cards?' }),
          ).getByRole('button', { name: 'Delete' }),
        )

        expect(await screen.findByRole('status')).toHaveTextContent(
          'Deleted 2 cards.',
        )
        const post = calls.find((call) => call.init?.method === 'POST')
        expect(post?.init?.body).toBe(JSON.stringify({ flashCardIds: [1, 2] }))
        expect(
          screen.getByRole('tab', { name: 'In this deck (0)' }),
        ).toBeInTheDocument()
        expect(
          screen.getByRole('tab', { name: 'Add cards (2)' }),
        ).toBeInTheDocument()
      })

      it('keeps the card and says why when deleting it fails', async () => {
        const user = userEvent.setup()
        mockDeckApi(animals, async () => new Response(null, { status: 500 }))
        await showPage('/decks/7')

        await user.click(
          screen.getByRole('button', { name: 'Delete "el gato"' }),
        )

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
        mockDeckApi(animals, async () => new Response(null, { status: 500 }))
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
        const many = Array.from({ length: 120 }, (_, index) => ({
          id: index + 1,
          spanish: [`palabra ${index + 1}`],
          english: [`word ${index + 1}`],
          tags: [],
          imageUrl: null,
        }))
        mockDeckApi(
          { ...animals, flashCardIds: many.map((card) => card.id) },
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
      })

      it('renames the deck', async () => {
        const user = userEvent.setup()
        const calls = mockDeckApi(animals, async () =>
          jsonResponse({ ...animals, name: 'Pets' }),
        )
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
        const put = calls.find((call) => call.init?.method === 'PUT')
        expect(put?.url).toBe(`${decksUrl}/7`)
        expect(put?.init?.body).toBe(JSON.stringify({ name: 'Pets' }))
        expect(trackEvent).toHaveBeenCalledWith('DeckRenamed')
      })

      it('deletes the deck and goes back to the list', async () => {
        const user = userEvent.setup()
        const calls = mockDeckApi(
          animals,
          async () => new Response(null, { status: 204 }),
        )
        await showPage('/decks/7')

        await user.click(screen.getByRole('button', { name: 'Delete deck' }))

        expect(
          await screen.findByRole('heading', { level: 2, name: 'New deck' }),
        ).toBeInTheDocument()
        expect(calls.find((call) => call.init?.method === 'DELETE')?.url).toBe(
          `${decksUrl}/7`,
        )
      })

      it('says so when the deck is gone', async () => {
        mockDeckApi(null)
        await showPage('/decks/7')

        expect(
          screen.getByRole('heading', { level: 2, name: 'Deck not found' }),
        ).toBeInTheDocument()
        expect(
          screen.getByRole('link', { name: 'Go to decks' }),
        ).toHaveAttribute('href', '/decks')
      })
    })

    describe('adding cards from the cards page', () => {
      async function showCardsWithDecks(
        handler: (url: string, init?: RequestInit) => Promise<Response>,
        path = '/',
      ) {
        const calls = mockFetch(
          async (url, init) =>
            init?.method === undefined
              ? jsonResponse(cards)
              : handler(url, init),
          [pets],
          [animals],
        )
        await showPage(path)
        return calls
      }

      it('adds the cards picked to a deck', async () => {
        const user = userEvent.setup()
        const calls = await showCardsWithDecks(async () =>
          jsonResponse({ ...animals, flashCardIds: [1, 2, 3] }),
        )

        expect(
          screen.getByRole('button', { name: 'Add to deck…' }),
        ).toBeDisabled()
        await user.click(
          screen.getByRole('checkbox', { name: 'Pick "la casa"' }),
        )
        await user.click(
          screen.getByRole('button', { name: 'Add 1 card to deck…' }),
        )
        await user.click(screen.getByRole('menuitem', { name: 'Animals' }))

        const status = await screen.findByRole('status')
        expect(status).toHaveTextContent('Added 1 card to Animals.')
        expect(
          within(status).getByRole('link', { name: 'Animals' }),
        ).toHaveAttribute('href', '/decks/7')
        const patch = calls.find((call) => call.init?.method === 'PATCH')
        expect(patch?.url).toBe(`${decksUrl}/7/cards`)
        expect(patch?.init?.body).toBe(JSON.stringify({ add: [3], remove: [] }))
        expect(
          screen.getByRole('checkbox', { name: 'Pick "la casa"' }),
        ).not.toBeChecked()
      })

      it("only picks all of the picked tag's cards", async () => {
        const user = userEvent.setup()
        const calls = await showCardsWithDecks(
          async () => jsonResponse({ ...animals }),
          '/?tag=4',
        )

        await user.click(screen.getByRole('checkbox', { name: 'Pick all 2' }))
        await user.click(
          screen.getByRole('button', { name: 'Add 2 cards to deck…' }),
        )
        await user.click(screen.getByRole('menuitem', { name: 'Animals' }))

        await screen.findByRole('status')
        expect(
          calls.find((call) => call.init?.method === 'PATCH')?.init?.body,
        ).toBe(JSON.stringify({ add: [1, 2], remove: [] }))
      })

      it('makes a new deck from the cards picked', async () => {
        const user = userEvent.setup()
        let attempts = 0
        const calls = await showCardsWithDecks(async () =>
          attempts++ === 0
            ? jsonResponse(
                {
                  errors: { Name: ["There's already a deck with that name."] },
                },
                400,
              )
            : jsonResponse({ id: 9, name: 'Home', flashCardIds: [3, 4] }, 201),
        )

        await user.click(
          screen.getByRole('checkbox', { name: 'Pick "la casa"' }),
        )
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
        const posts = calls.filter(
          (call) => call.init?.method === 'POST' && call.url === decksUrl,
        )
        expect(posts.at(-1)?.init?.body).toBe(
          JSON.stringify({ name: 'Home', flashCardIds: [3, 4] }),
        )
        expect(trackException).not.toHaveBeenCalled()
      })
    })
  })

  describe('importing cards', () => {
    const systemDecksUrl = 'http://localhost:5269/api/system-decks'
    const daysTag = { id: 30, name: 'Days' }
    const days: SystemDeck = {
      id: 3,
      name: 'Days of the week',
      cards: [
        {
          id: 31,
          spanish: ['lunes'],
          english: ['Monday'],
          tags: [daysTag],
          imageUrl: null,
        },
        {
          id: 32,
          spanish: ['martes'],
          english: ['Tuesday'],
          tags: [daysTag, { id: 33, name: 'Week' }],
          imageUrl: null,
        },
      ],
    }
    const months: SystemDeck = {
      id: 4,
      name: 'Months',
      cards: [
        {
          id: 41,
          spanish: ['enero'],
          english: ['January'],
          tags: [{ id: 42, name: 'Months' }],
          imageUrl: null,
        },
      ],
    }

    // Shows the Import cards page with these built-in decks, answering anything else with the handler.
    async function showImport(
      handler: (url: string, init?: RequestInit) => Promise<Response> = () => {
        throw new Error('Unexpected request')
      },
      decks: SystemDeck[] = [days, months],
    ) {
      const calls = mockFetch(async (url, init) =>
        init?.method === undefined && url === systemDecksUrl
          ? jsonResponse(decks)
          : handler(url, init),
      )
      renderAt('/import')
      await waitFor(() => {
        expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      })
      return calls
    }

    it('lists the built-in decks with their card counts', async () => {
      await showImport()

      // The built-in decks' tab is open, next to the document's and Preply's.
      expect(
        screen.getByRole('tab', { name: 'Built-in decks' }),
      ).toHaveAttribute('aria-selected', 'true')
      expect(
        screen.getByRole('tab', { name: 'From a document' }),
      ).toHaveAttribute('aria-selected', 'false')
      expect(screen.getByRole('tab', { name: 'From Preply' })).toHaveAttribute(
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
      const calls = await showImport(async () =>
        jsonResponse(
          {
            deck: { id: 21, name: 'Days of the week', flashCardIds: [5, 6] },
            importedCount: 2,
            skippedCount: 0,
          },
          201,
        ),
      )

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
      const post = calls.find((call) => call.init?.method === 'POST')
      expect(post?.url).toBe(`${systemDecksUrl}/3/import`)
      expect(trackEvent).toHaveBeenCalledWith('SystemDeckImported')
    })

    it('says how many cards were left out', async () => {
      const user = userEvent.setup()
      await showImport(async () =>
        jsonResponse(
          {
            deck: { id: 22, name: 'Days of the week (2)', flashCardIds: [7] },
            importedCount: 1,
            skippedCount: 1,
          },
          201,
        ),
      )

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
      await showImport(async () =>
        jsonResponse(
          { status: 409, detail: 'You already have all of these cards.' },
          409,
        ),
      )

      await user.click(
        screen.getByRole('button', { name: 'Add deck "Months"' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'You already have all of these cards.',
      )
      expect(
        screen.queryByRole('link', { name: 'Open deck' }),
      ).not.toBeInTheDocument()
      expect(trackException).not.toHaveBeenCalled()
    })

    it("says when the built-in decks can't be loaded", async () => {
      mockFetch(unreachable)
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

  describe('importing from Preply', () => {
    const flashCardsUrl = 'http://localhost:5269/api/flashcards'
    const words = [
      { spanish: 'tostado', english: 'toasted', partOfSpeech: 'adjective' },
      { spanish: 'avena', english: 'oatmeal', partOfSpeech: 'noun' },
      { spanish: 'gustaron', english: null, partOfSpeech: null },
      { spanish: 'picante', english: 'spicy', partOfSpeech: null },
      { spanish: 'el pan', english: 'bread', partOfSpeech: 'noun' },
    ]
    // The user already has a card for "el pan", whatever its case.
    const ownCards: FlashCard[] = [
      {
        id: 1,
        spanish: ['El Pan'],
        english: ['the bread'],
        tags: [],
        imageUrl: null,
      },
    ]
    const preplyDeck: Deck = { id: 40, name: 'Preply', flashCardIds: [] }

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

    function savedCard(id: number, spanish: string, english: string) {
      return {
        id,
        spanish: [spanish],
        english: [english],
        tags: [],
        imageUrl: null,
      }
    }

    beforeEach(() => {
      vi.spyOn(window, 'postMessage').mockImplementation(() => {})
      startPreplyHandoff(opened)
    })

    afterEach(() => {
      clearPreplyHandoff()
    })

    // Shows the Import cards page's Preply tab, as the bookmarklet opens it, with the user's cards and decks loaded.
    // Saving anything is answered with save. The other tabs' lists are empty.
    async function showPreply(
      save: (url: string, init?: RequestInit) => Promise<Response> = () => {
        throw new Error('Unexpected request')
      },
      decks: Deck[] = [],
    ) {
      const calls = mockFetch(
        async (url, init) =>
          init?.method !== undefined
            ? save(url, init)
            : jsonResponse(url === flashCardsUrl ? ownCards : []),
        [],
        decks,
      )
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
      return screen.getByRole('list', { name: 'Cards from Preply' })
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

    it('adds one card to a new Preply deck', async () => {
      const user = userEvent.setup()
      const calls = await showPreply(async (url) =>
        url === flashCardsUrl
          ? jsonResponse(savedCard(8, 'avena', 'oatmeal'), 201)
          : jsonResponse({ ...preplyDeck, flashCardIds: [8] }, 201),
      )
      const list = await receiveWords()

      await user.click(
        within(list).getByRole('button', { name: 'Add "avena"' }),
      )

      expect(
        await screen.findByText('Added “avena” to your Preply deck.'),
      ).toBeInTheDocument()
      expect(
        within(list).queryByRole('button', { name: 'Add "avena"' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getAllByRole('button', { name: 'Add all 2 cards' }),
      ).toHaveLength(2)
      const posts = calls.filter((call) => call.init?.method === 'POST')
      expect(posts.map((call) => call.url)).toEqual([flashCardsUrl, decksUrl])
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

    it('adds all the cards left to the Preply deck the user has', async () => {
      const user = userEvent.setup()
      const calls = await showPreply(
        async (url) =>
          url === `${flashCardsUrl}/batch`
            ? jsonResponse({
                cards: [savedCard(9, 'tostado', 'toasted')],
                skippedCount: 1,
              })
            : jsonResponse({ ...preplyDeck, flashCardIds: [5, 9] }),
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
      const batch = calls.find((call) => call.url === `${flashCardsUrl}/batch`)
      expect(JSON.parse(batch?.init?.body as string)).toEqual({
        cards: [
          { spanish: ['tostado'], english: ['toasted'], tags: [] },
          { spanish: ['picante'], english: ['spicy'], tags: [] },
        ],
      })
      // The cards go in the deck the user already has, whatever its case.
      const patch = calls.find((call) => call.init?.method === 'PATCH')
      expect(patch?.url).toBe(`${decksUrl}/40/cards`)
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
      await showPreply(async () =>
        jsonResponse(
          {
            status: 409,
            detail: 'You already have a flash card with that word.',
          },
          409,
        ),
      )
      const list = await receiveWords()

      await user.click(
        within(list).getByRole('button', { name: 'Add "tostado"' }),
      )

      expect(
        await screen.findByText(
          'You already have a flash card with that word.',
        ),
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

      expect(
        screen.getByText(/No words came from Preply\./),
      ).toBeInTheDocument()
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
      clearPreplyHandoff()
      await showPreply()

      expect(
        screen.getByRole('link', { name: 'Send to FlashCardSage' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('Getting your words from Preply…'),
      ).not.toBeInTheDocument()
    })

    it('tells phone users to bring in their words on a computer', async () => {
      // A touch screen with no mouse, as a phone has. jsdom has no matchMedia of its own.
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === touchOnlyQuery,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }))
      try {
        clearPreplyHandoff()
        await showPreply()

        expect(
          screen.getByText(/Bringing in your Preply words needs a computer\./),
        ).toBeInTheDocument()
        expect(
          screen.queryByRole('link', { name: 'Send to FlashCardSage' }),
        ).not.toBeInTheDocument()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('modes', () => {
    it('shows how many cards, decks and tags the user has', async () => {
      counts = { cards: 12, decks: 3, tags: 1 }
      mockFetch(async () => jsonResponse([]))
      renderAt('/')
      const sections = screen.getByRole('navigation', { name: 'Manage cards' })

      expect(
        await within(sections).findByRole('link', { name: 'Cards 12' }),
      ).toHaveAttribute('href', '/')
      expect(
        within(sections).getByRole('link', { name: 'Decks 3' }),
      ).toHaveAttribute('href', '/decks')
      expect(
        within(sections).getByRole('link', { name: 'Tags 1' }),
      ).toHaveAttribute('href', '/tags')
      expect(
        within(sections).getByRole('link', { name: 'Import cards' }),
      ).toHaveAttribute('href', '/import')
    })

    it("leaves the counts out when they can't be loaded", async () => {
      counts = null
      mockFetch(async () => jsonResponse([]))
      renderAt('/')

      await waitFor(() => {
        expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
          operation: 'refreshCounts',
        })
      })
      const sections = screen.getByRole('navigation', { name: 'Manage cards' })
      expect(
        within(sections).getByRole('link', { name: 'Cards' }),
      ).toBeInTheDocument()
    })

    it('links to each mode and marks the current one', async () => {
      const user = userEvent.setup()
      // No cards, so there's nothing to practice either.
      mockFetch(async (url) =>
        url.endsWith('/practice/next')
          ? new Response(null, { status: 204 })
          : jsonResponse([]),
      )
      renderAt('/')
      await waitFor(() => {
        expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      })
      const nav = screen.getByRole('navigation', { name: 'Mode' })
      const hrefs = (links: HTMLElement[]) =>
        links.map((link) => link.getAttribute('href'))

      expect(hrefs(within(nav).getAllByRole('link'))).toEqual([
        '/',
        '/practice',
        '/scores',
      ])
      // Manage cards is the section the user is in, and Cards the page in it.
      expect(
        within(nav).getByRole('link', { name: 'Manage cards' }),
      ).toHaveAttribute('aria-current', 'true')
      const sections = screen.getByRole('navigation', { name: 'Manage cards' })
      expect(hrefs(within(sections).getAllByRole('link'))).toEqual([
        '/',
        '/decks',
        '/tags',
        '/import',
      ])
      expect(
        await within(sections).findByRole('link', { name: 'Cards 0' }),
      ).toHaveAttribute('aria-current', 'page')

      await user.click(within(sections).getByRole('link', { name: 'Tags 0' }))

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Tags' }),
      ).toBeInTheDocument()
      expect(
        within(sections).getByRole('link', { name: 'Tags 0' }),
      ).toHaveAttribute('aria-current', 'page')
      expect(
        within(sections).getByRole('link', { name: 'Cards 0' }),
      ).not.toHaveAttribute('aria-current')
      expect(
        within(nav).getByRole('link', { name: 'Manage cards' }),
      ).toHaveAttribute('aria-current', 'true')

      await user.click(within(nav).getByRole('link', { name: 'Practice' }))

      expect(
        await screen.findByText('There are no flash cards to practice yet.'),
      ).toBeInTheDocument()
      expect(
        within(nav).getByRole('link', { name: 'Practice' }),
      ).toHaveAttribute('aria-current', 'page')
      expect(
        within(nav).getByRole('link', { name: 'Manage cards' }),
      ).not.toHaveAttribute('aria-current')
      // Practice has no sections.
      expect(
        screen.queryByRole('navigation', { name: 'Manage cards' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('practicing', () => {
    const cat = { id: 1, spanish: ['el gato'], english: ['the cat'] }
    const dog = { id: 2, spanish: ['el perro'], english: ['the dog'] }

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
      }: {
        next?: unknown
        status?: number
        scoreChanges?: number[]
        path?: string
        tags?: Tag[]
        decks?: Deck[]
      } = {},
    ) {
      let answers = 0
      const calls = mockFetch(
        async (_url, init) => {
          if (init?.method === 'POST') {
            // Each answer gets the next score change, and the last one after that.
            const scoreChange =
              scoreChanges[Math.min(answers++, scoreChanges.length - 1)]
            return status === 200
              ? jsonResponse({ next, scoreChange })
              : new Response(null, { status })
          }
          return first === null
            ? new Response(null, { status: 204 })
            : jsonResponse(first)
        },
        tags,
        decks,
      )
      renderAt(path)
      await waitFor(() => {
        expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      })
      return calls
    }

    // The urls the page asked for its practice cards from, in order.
    function nextUrls(calls: Call[]) {
      return calls
        .map((call) => call.url)
        .filter((url) => url.includes('/practice/next'))
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

      expect(screen.getByText('solo / únicamente')).toHaveAttribute(
        'lang',
        'es',
      )
    })

    it('shows the Spanish of the card the API picks until it is revealed', async () => {
      const user = userEvent.setup()
      const calls = await practice({ ...cat, side: 'Spanish' })

      expect(nextUrls(calls)).toEqual([
        'http://localhost:5269/api/flashcards/practice/next',
      ])
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
      preferences = { ...defaultPreferences, showPictures: false }
      const user = userEvent.setup()
      await practice({
        ...cat,
        side: 'Spanish',
        imageUrl: 'http://images.test/1.png',
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
        const post = calls.find((call) => call.init?.method === 'POST')
        expect(post?.url).toBe(
          'http://localhost:5269/api/flashcards/1/practice-results',
        )
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
      const animals: Deck = { id: 3, name: 'Animals', flashCardIds: [1, 2] }
      const pets: Tag = { id: 4, name: 'Pets' }

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
            'http://localhost:5269/api/flashcards/practice/next?deckId=3',
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
          'http://localhost:5269/api/flashcards/practice/next?deckId=3',
        ])
        await user.click(screen.getByRole('button', { name: 'Reveal' }))
        await user.click(screen.getByRole('button', { name: 'Got it!' }))

        expect(await screen.findByText('el perro')).toBeInTheDocument()
        expect(calls.find((call) => call.init?.method === 'POST')?.url).toBe(
          'http://localhost:5269/api/flashcards/1/practice-results?deckId=3',
        )
      })

      it('practices the tag in the URL', async () => {
        const calls = await practice(
          { ...cat, side: 'Spanish' },
          { path: '/practice?tag=4', tags: [pets] },
        )

        expect(nextUrls(calls)).toEqual([
          'http://localhost:5269/api/flashcards/practice/next?tagId=4',
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

        expect(nextUrls(calls)).toEqual([
          'http://localhost:5269/api/flashcards/practice/next',
        ])
        expect(
          screen.getByRole('combobox', { name: 'Practice' }),
        ).toHaveTextContent('All cards')
      })

      it('links to the decks when the deck has no cards', async () => {
        await practice(null, { path: '/practice?deck=3', decks: [animals] })

        expect(
          screen.getByText('There are no cards in this deck.'),
        ).toBeInTheDocument()
        expect(
          screen.getByRole('link', { name: 'Edit decks' }),
        ).toHaveAttribute('href', '/decks')
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
      mockFetch(async () => new Response(null, { status: 500 }))
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

  describe('scores', () => {
    it('shows the total and each card with its score, in the order given', async () => {
      const calls = mockFetch(async () =>
        jsonResponse({
          total: 130,
          maximum: 300,
          cards: [
            { id: 3, spanish: ['la casa'], english: ['the house'], score: 0 },
            { id: 2, spanish: ['el perro'], english: ['the dog'], score: 50 },
            { id: 1, spanish: ['el gato'], english: ['the cat'], score: 80 },
          ],
        }),
      )
      renderAt('/scores')

      expect(
        await screen.findByText('Total score 130 / 300 (43%)'),
      ).toBeInTheDocument()
      const items = within(
        screen.getByRole('list', { name: 'Card scores' }),
      ).getAllByRole('listitem')
      expect(items.map((item) => item.textContent)).toEqual([
        'la casathe house0 / 100',
        'el perrothe dog50 / 100',
        'el gatothe cat80 / 100',
      ])
      expect(screen.getByText('la casa')).toHaveAttribute('lang', 'es')
      expect(calls[0].url).toMatch(/\/api\/flashcards\/scores$/)
    })

    it('shades each card from red for a low score to green for a high one', async () => {
      mockFetch(async () =>
        jsonResponse({
          total: 150,
          maximum: 300,
          cards: [
            { id: 3, spanish: ['la casa'], english: ['the house'], score: 0 },
            { id: 2, spanish: ['el perro'], english: ['the dog'], score: 50 },
            { id: 1, spanish: ['el gato'], english: ['the cat'], score: 100 },
          ],
        }),
      )
      renderAt('/scores')

      await screen.findByText('Total score 150 / 300 (50%)')
      const items = within(
        screen.getByRole('list', { name: 'Card scores' }),
      ).getAllByRole('listitem')
      expect(items[0]).toHaveStyle({ backgroundColor: 'hsl(0, 70%, 90%)' })
      expect(items[1]).toHaveStyle({ backgroundColor: 'hsl(60, 70%, 90%)' })
      expect(items[2]).toHaveStyle({ backgroundColor: 'hsl(120, 70%, 90%)' })
    })

    it('links to adding cards when there are none', async () => {
      mockFetch(async () => jsonResponse({ total: 0, maximum: 0, cards: [] }))
      renderAt('/scores')

      expect(
        await screen.findByText('There are no flash cards to score yet.'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Add flash cards' }),
      ).toHaveAttribute('href', '/')
    })

    it('shows an error when loading fails', async () => {
      mockFetch(async () => new Response(null, { status: 500 }))
      renderAt('/scores')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Unable to load scores.',
      )
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'scores',
      })
    })

    it('says to try again when the API is unreachable', async () => {
      mockFetch(unreachable)
      renderAt('/scores')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        unreachableMessage,
      )
    })
  })

  describe('preferences', () => {
    const cat = {
      id: 1,
      spanish: ['el gato'],
      english: ['the cat'],
      tags: [],
      imageUrl: 'http://images.test/1.png',
    }

    // Lists the cat, and answers saving the preferences with status, as the API would.
    function mockPreferences(status = 200) {
      return mockFetch(async (_url, init) => {
        if (init?.method === 'PUT') {
          return status === 200
            ? new Response(init.body as string, {
                headers: { 'Content-Type': 'application/json' },
              })
            : new Response(null, { status })
        }
        return jsonResponse([cat])
      })
    }

    function preferenceSwitch(name: string) {
      return screen.getByRole('switch', { name })
    }

    it('links to the page from the top, which shows the preferences the user has', async () => {
      const user = userEvent.setup()
      preferences = { ...defaultPreferences, showSuggestions: false }
      mockPreferences()
      renderAt('/')
      await screen.findByText('el gato')

      // A cog icon, named for screen readers, rather than text.
      const link = screen.getByRole('link', { name: 'Preferences' })
      expect(link).not.toHaveTextContent(/\S/)
      await user.click(link)

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Preferences' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Preferences' })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(preferenceSwitch('Show pictures')).toBeChecked()
      expect(preferenceSwitch('Suggest cards')).not.toBeChecked()
      expect(preferenceSwitch('Translate automatically')).toBeChecked()
      expect(
        preferenceSwitch('Translate automatically'),
      ).toHaveAccessibleDescription(/you type both sides/)
    })

    it("saves a change as soon as it's made, and the app follows it", async () => {
      const user = userEvent.setup()
      const calls = mockPreferences()
      renderAt('/preferences')

      await user.click(
        await screen.findByRole('switch', { name: 'Show pictures' }),
      )

      expect(preferenceSwitch('Show pictures')).not.toBeChecked()
      expect(preferenceSwitch('Show pictures')).toHaveFocus()
      await waitFor(() => {
        expect(trackEvent).toHaveBeenCalledWith('PreferencesUpdated')
      })
      expect(
        calls.map((call) => [call.init?.method, call.url, call.init?.body]),
      ).toEqual([
        [
          'PUT',
          'http://localhost:5269/api/preferences',
          JSON.stringify({
            showPictures: false,
            showSuggestions: true,
            autoTranslate: true,
          }),
        ],
      ])

      await user.click(screen.getByRole('link', { name: 'Manage cards' }))

      expect(await screen.findByText('el gato')).toBeInTheDocument()
      expect(
        screen.queryByRole('img', { name: /picture/i }),
      ).not.toBeInTheDocument()
    })

    it("turns a change back and says why when it isn't saved", async () => {
      const user = userEvent.setup()
      mockPreferences(500)
      renderAt('/preferences')

      await user.click(
        await screen.findByRole('switch', { name: 'Suggest cards' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Unable to save preferences.',
      )
      expect(preferenceSwitch('Suggest cards')).toBeChecked()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'savePreferences',
      })
    })

    it("works as it does for a new user when the preferences can't be loaded", async () => {
      preferences = null
      mockPreferences()
      renderAt('/')

      expect(
        await screen.findByRole('img', { name: 'Picture for "el gato"' }),
      ).toBeInTheDocument()
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'loadPreferences',
      })
    })
  })
})
