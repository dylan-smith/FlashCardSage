import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { tagline } from '../App'
import { unreachableMessage } from '../api/flashCards'
import { setSession } from '../auth/session'
import { trackEvent, trackException } from '../telemetry'

vi.mock('../telemetry', () => ({
  trackEvent: vi.fn(),
  trackException: vi.fn(),
  trackPageView: vi.fn(),
}))

type Call = { url: string; init?: RequestInit }

// Answers every fetch with the handler, and keeps the calls so a test can check what was sent.
function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const calls: Call[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      calls.push({ url, init })
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

// Renders the flash cards page with these cards already loaded.
async function showCards(
  cards: { id: number; spanish: string; english: string }[],
) {
  const calls = mockFetch(async (url, init) => {
    if (init?.method === undefined) {
      return jsonResponse(cards)
    }
    throw new Error(`Unexpected ${init.method} ${url}`)
  })
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
          { id: 1, spanish: 'el gato', english: 'the cat' },
          { id: 2, spanish: 'el perro', english: 'the dog' },
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
          ? jsonResponse({ id: 7, spanish: 'el gato', english: 'the cat' }, 201)
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
        JSON.stringify({ spanish: 'el gato', english: 'the cat' }),
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
      expect(calls).toHaveLength(1)
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
      expect(calls).toHaveLength(1)
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

  describe('editing a card', () => {
    it('saves both changed sides', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? jsonResponse({ id: 1, spanish: 'el perro', english: 'the dog' })
          : jsonResponse([
              { id: 1, spanish: 'el gato', english: 'the cat' },
              { id: 2, spanish: 'la casa', english: 'the house' },
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
        JSON.stringify({ spanish: 'el perro', english: 'the dog' }),
      )
      expect(trackEvent).toHaveBeenCalledWith('FlashCardUpdated')
    })

    it('can be cancelled, keeping the old card', async () => {
      const user = userEvent.setup()
      const { calls } = await showCards([
        { id: 1, spanish: 'el gato', english: 'the cat' },
      ])

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      const input = screen.getByDisplayValue('el gato')
      await user.clear(input)
      await user.type(input, 'changed')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.getByText('el gato')).toBeInTheDocument()
      expect(screen.queryByText('changed')).not.toBeInTheDocument()
      expect(calls).toHaveLength(1)
    })

    it('asks for the English instead of saving a blank one', async () => {
      const user = userEvent.setup()
      const { calls } = await showCards([
        { id: 1, spanish: 'el gato', english: 'the cat' },
      ])

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      await user.clear(screen.getByDisplayValue('the cat'))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'English is required.',
      )
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(calls).toHaveLength(1)
    })

    it('shows an error and stays in edit mode when saving fails', async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? new Response(null, { status: 500 })
          : jsonResponse([{ id: 1, spanish: 'el gato', english: 'the cat' }]),
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

  describe('deleting a card', () => {
    it('removes the card from the list', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(async (_url, init) =>
        init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : jsonResponse([
              { id: 1, spanish: 'el gato', english: 'the cat' },
              { id: 2, spanish: 'la casa', english: 'the house' },
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
          : jsonResponse([{ id: 1, spanish: 'el gato', english: 'the cat' }]),
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
          : jsonResponse([{ id: 1, spanish: 'el gato', english: 'the cat' }]),
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
