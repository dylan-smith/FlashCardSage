import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { tagline } from '../App'
import { unreachableMessage } from '../api/flashCards'
import type { FlashCard, Tag } from '../api/flashCards'
import { setSession } from '../auth/session'
import { translateDelayMs } from '../hooks/useAutoTranslate'
import { trackEvent, trackException } from '../telemetry'

vi.mock('../telemetry', () => ({
  trackEvent: vi.fn(),
  trackException: vi.fn(),
  trackPageView: vi.fn(),
}))

type Call = { url: string; init?: RequestInit }

const tagsUrl = 'http://localhost:5269/api/tags'
const suggestionsUrl = 'http://localhost:5269/api/card-suggestions'

// Answers every fetch with the handler, except that loading the tags gets these tags and loading suggestions gets
// what suggest answers (by default, that they aren't available). It keeps the calls, apart from the suggestions, so
// a test can check what was sent.
function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  tags: Tag[] = [],
  suggest: () => Promise<Response> = async () =>
    new Response(null, { status: 503 }),
) {
  const calls: Call[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === suggestionsUrl) {
        return suggest()
      }
      calls.push({ url, init })
      return url === tagsUrl && init?.method === undefined
        ? Promise.resolve(jsonResponse(tags))
        : handler(url, init)
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
      mockFetch(async () => jsonResponse([]))

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
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('loading the list', () => {
    it('shows a loading state, then the cards in order', async () => {
      mockFetch(async () =>
        jsonResponse([
          { id: 1, spanish: 'el gato', english: 'the cat', tags: [] },
          { id: 2, spanish: 'el perro', english: 'the dog', tags: [] },
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
              { id: 7, spanish: 'el gato', english: 'the cat', tags: [] },
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
        JSON.stringify({ spanish: 'el gato', english: 'the cat', tags: [] }),
      )
      expect(trackEvent).toHaveBeenCalledWith('FlashCardCreated')
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
      expect(calls).toHaveLength(2)
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
      expect(calls).toHaveLength(2)
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
              { id: 1, spanish: 'el gato', english: 'the cat', tags: [] },
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
      spanish: 'el gato',
      english: 'the cat',
      tags: [],
    }

    // Renders the flash cards page with these cards, answering suggestions with suggest and a new card with save.
    async function showSuggestions(
      suggest: () => Promise<Response>,
      save: () => Promise<Response> = async () => {
        throw new Error('Unexpected POST')
      },
    ) {
      const calls = mockFetch(
        async (_url, init) =>
          init?.method === 'POST' ? save() : jsonResponse([cat]),
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
            { id: 2, spanish: 'el perro', english: 'the dog', tags: [] },
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
        JSON.stringify({ spanish: 'el perro', english: 'the dog', tags: [] }),
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
  })

  describe('editing a card', () => {
    it('saves both changed sides', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? jsonResponse({
              id: 1,
              spanish: 'el perro',
              english: 'the dog',
              tags: [],
            })
          : jsonResponse([
              { id: 1, spanish: 'el gato', english: 'the cat', tags: [] },
              { id: 2, spanish: 'la casa', english: 'the house', tags: [] },
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
        JSON.stringify({ spanish: 'el perro', english: 'the dog', tags: [] }),
      )
      expect(trackEvent).toHaveBeenCalledWith('FlashCardUpdated')
    })

    it('can be cancelled, keeping the old card', async () => {
      const user = userEvent.setup()
      const { calls } = await showCards([
        { id: 1, spanish: 'el gato', english: 'the cat', tags: [] },
      ])

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      const input = screen.getByDisplayValue('el gato')
      await user.clear(input)
      await user.type(input, 'changed')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.getByText('el gato')).toBeInTheDocument()
      expect(screen.queryByText('changed')).not.toBeInTheDocument()
      expect(calls).toHaveLength(2)
    })

    it('asks for the English instead of saving a blank one', async () => {
      const user = userEvent.setup()
      const { calls } = await showCards([
        { id: 1, spanish: 'el gato', english: 'the cat', tags: [] },
      ])

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      await user.clear(screen.getByDisplayValue('the cat'))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'English is required.',
      )
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(calls).toHaveLength(2)
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
              { id: 1, spanish: 'el gato', english: 'the cat', tags: [] },
              { id: 2, spanish: 'el perro', english: 'the dog', tags: [] },
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
              { id: 1, spanish: 'el gato', english: 'the cat', tags: [] },
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
          return jsonResponse({ id: 7, ...body, tags: [] }, 201)
        }
        if (init?.method === 'PUT') {
          return jsonResponse({ id: 1, ...body, tags: [] })
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
    })

    it('translates a changed side of a card being edited', async () => {
      const user = userEvent.setup()
      const translations = mockTranslations([
        { id: 1, spanish: 'el gato', english: 'the cat', tags: [] },
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
  })

  describe('deleting a card', () => {
    it('removes the card from the list', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(async (_url, init) =>
        init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : jsonResponse([
              { id: 1, spanish: 'el gato', english: 'the cat', tags: [] },
              { id: 2, spanish: 'la casa', english: 'the house', tags: [] },
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
              { id: 1, spanish: 'el gato', english: 'the cat', tags: [] },
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
              { id: 1, spanish: 'el gato', english: 'the cat', tags: [] },
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

  describe('tags', () => {
    const food = { id: 1, name: 'Food' }
    const travel = { id: 2, name: 'Travel' }
    const apple = {
      id: 1,
      spanish: 'la manzana',
      english: 'the apple',
      tags: [food],
    }
    const train = {
      id: 2,
      spanish: 'el tren',
      english: 'the train',
      tags: [travel],
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
                  spanish: 'el pan',
                  english: 'the bread',
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
          spanish: 'el pan',
          english: 'the bread',
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
          spanish: 'la manzana',
          english: 'the apple',
          tags: ['Food', 'Travel'],
        }),
      )
    })

    it('renames the picked tag', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(
        async (_url, init) =>
          init?.method === 'PUT'
            ? jsonResponse({ id: 1, name: 'Groceries' })
            : jsonResponse([apple, train]),
        [food, travel],
      )
      renderAt('/')
      await screen.findByText('la manzana')

      await user.click(screen.getByRole('button', { name: 'Food (1)' }))
      await user.click(
        screen.getByRole('button', { name: 'Rename tag "Food"' }),
      )
      const name = screen.getByLabelText('Tag name')
      expect(name).toHaveFocus()
      await user.clear(name)
      await user.type(name, ' Groceries ')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(
        await screen.findByRole('button', { name: 'Groceries (1)' }),
      ).toHaveAttribute('aria-pressed', 'true')
      expect(
        within(screen.getByRole('listitem')).getByText('Groceries'),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText('Tag name')).not.toBeInTheDocument()
      const put = calls.find((call) => call.init?.method === 'PUT')
      expect(put?.url).toBe(`${tagsUrl}/1`)
      expect(put?.init?.body).toBe(JSON.stringify({ name: 'Groceries' }))
      expect(trackEvent).toHaveBeenCalledWith('TagRenamed')
    })

    it("shows the API's reason when it rejects a new name", async () => {
      const user = userEvent.setup()
      mockFetch(
        async (_url, init) =>
          init?.method === 'PUT'
            ? jsonResponse(
                { errors: { Name: ["There's already a tag with that name."] } },
                400,
              )
            : jsonResponse([apple, train]),
        [food, travel],
      )
      renderAt('/')
      await screen.findByText('la manzana')

      await user.click(screen.getByRole('button', { name: 'Food (1)' }))
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

    it('deletes the picked tag and shows every card again', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(
        async (_url, init) =>
          init?.method === 'DELETE'
            ? new Response(null, { status: 204 })
            : jsonResponse([apple, train]),
        [food, travel],
      )
      renderAt('/')
      await screen.findByText('la manzana')

      await user.click(screen.getByRole('button', { name: 'Food (1)' }))
      await user.click(
        screen.getByRole('button', { name: 'Delete tag "Food"' }),
      )

      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Food (1)' }),
        ).not.toBeInTheDocument()
      })
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
      expect(screen.queryByText('Food')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'All (2)' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(calls.find((call) => call.init?.method === 'DELETE')?.url).toBe(
        `${tagsUrl}/1`,
      )
      expect(trackEvent).toHaveBeenCalledWith('TagDeleted')
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

  describe('modes', () => {
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

      expect(
        within(nav)
          .getAllByRole('link')
          .map((link) => link.getAttribute('href')),
      ).toEqual(['/', '/practice', '/scores'])
      expect(
        within(nav).getByRole('link', { name: 'Manage cards' }),
      ).toHaveAttribute('aria-current', 'page')
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
    })
  })

  describe('practicing', () => {
    const cat = { id: 1, spanish: 'el gato', english: 'the cat' }
    const dog = { id: 2, spanish: 'el perro', english: 'the dog' }

    // Starts on the first card the API picks, then answers each saved result with the next card it picks, or with
    // the status when it isn't saved.
    async function practice(
      first: unknown,
      {
        next = { ...dog, side: 'Spanish' },
        status = 200,
        scoreChanges = [0],
      }: { next?: unknown; status?: number; scoreChanges?: number[] } = {},
    ) {
      let answers = 0
      const calls = mockFetch(async (_url, init) => {
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
      })
      renderAt('/practice')
      await waitFor(() => {
        expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
      })
      return calls
    }

    it('shows the Spanish of the card the API picks until it is revealed', async () => {
      const user = userEvent.setup()
      const calls = await practice({ ...cat, side: 'Spanish' })

      expect(calls[0].url).toBe(
        'http://localhost:5269/api/flashcards/practice/next',
      )
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
            { id: 3, spanish: 'la casa', english: 'the house', score: 0 },
            { id: 2, spanish: 'el perro', english: 'the dog', score: 50 },
            { id: 1, spanish: 'el gato', english: 'the cat', score: 80 },
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
            { id: 3, spanish: 'la casa', english: 'the house', score: 0 },
            { id: 2, spanish: 'el perro', english: 'the dog', score: 50 },
            { id: 1, spanish: 'el gato', english: 'the cat', score: 100 },
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
})
