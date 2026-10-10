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
async function showCards(cards: { id: number; title: string }[]) {
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
        screen.getByLabelText('Title', { exact: false }),
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
          { id: 1, title: 'el gato' },
          { id: 2, title: 'el perro' },
        ]),
      )

      renderAt('/')

      expect(screen.getByLabelText('Loading')).toBeInTheDocument()
      const items = await screen.findAllByRole('listitem')
      expect(items.map((item) => item.textContent)).toEqual([
        'el gatoEditDelete',
        'el perroEditDelete',
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
    it('sends the trimmed title, adds the card to the list and clears the input', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(async (_url, init) =>
        init?.method === 'POST'
          ? jsonResponse({ id: 7, title: 'el gato' }, 201)
          : jsonResponse([]),
      )
      renderAt('/')
      await screen.findByText('No flash cards yet.')

      await user.type(
        screen.getByLabelText('Title', { exact: false }),
        '  el gato  ',
      )
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(await screen.findByText('el gato')).toBeInTheDocument()
      expect(screen.queryByText('No flash cards yet.')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Title', { exact: false })).toHaveValue('')
      const post = calls.find((call) => call.init?.method === 'POST')
      expect(post?.url).toBe('http://localhost:5269/api/flashcards')
      expect(post?.init?.body).toBe(JSON.stringify({ title: 'el gato' }))
      expect(trackEvent).toHaveBeenCalledWith('FlashCardCreated')
    })

    it('asks for a title instead of sending a blank one', async () => {
      const user = userEvent.setup()
      const { calls } = await showCards([])
      const input = screen.getByLabelText('Title', { exact: false })
      // The field is required, so submit the form around it rather than clicking the button.
      input.removeAttribute('required')

      await user.type(input, '   ')
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(screen.getByRole('alert')).toHaveTextContent('Title is required.')
      expect(calls).toHaveLength(1)
    })

    it("shows the API's reason when it rejects the title", async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'POST'
          ? jsonResponse({ errors: { Title: ['Title is required.'] } }, 400)
          : jsonResponse([]),
      )
      renderAt('/')
      await screen.findByText('No flash cards yet.')

      await user.type(screen.getByLabelText('Title', { exact: false }), 'x')
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Title is required.',
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
        screen.getByLabelText('Title', { exact: false }),
        'el gato',
      )
      await user.click(screen.getByRole('button', { name: 'Add flash card' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Unable to save flash card.',
      )
      expect(screen.getByLabelText('Title', { exact: false })).toHaveValue(
        'el gato',
      )
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'create',
      })
    })
  })

  describe('editing a card', () => {
    it('saves the new title', async () => {
      const user = userEvent.setup()
      const calls = mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? jsonResponse({ id: 1, title: 'el perro' })
          : jsonResponse([
              { id: 1, title: 'el gato' },
              { id: 2, title: 'la casa' },
            ]),
      )
      renderAt('/')
      await screen.findByText('el gato')

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      const item = screen.getAllByRole('listitem')[0]
      const input = within(item).getByLabelText('Title')
      expect(input).toHaveValue('el gato')
      await user.clear(input)
      await user.type(input, ' el perro ')
      await user.click(within(item).getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('el perro')).toBeInTheDocument()
      expect(screen.queryByText('el gato')).not.toBeInTheDocument()
      expect(screen.getByText('la casa')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument()
      const put = calls.find((call) => call.init?.method === 'PUT')
      expect(put?.url).toBe('http://localhost:5269/api/flashcards/1')
      expect(put?.init?.body).toBe(JSON.stringify({ title: 'el perro' }))
      expect(trackEvent).toHaveBeenCalledWith('FlashCardUpdated')
    })

    it('can be cancelled, keeping the old title', async () => {
      const user = userEvent.setup()
      const { calls } = await showCards([{ id: 1, title: 'el gato' }])

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      const input = screen.getByLabelText('Title', { selector: 'input[value]' })
      await user.clear(input)
      await user.type(input, 'changed')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.getByText('el gato')).toBeInTheDocument()
      expect(screen.queryByText('changed')).not.toBeInTheDocument()
      expect(calls).toHaveLength(1)
    })

    it('asks for a title instead of saving a blank one', async () => {
      const user = userEvent.setup()
      const { calls } = await showCards([{ id: 1, title: 'el gato' }])

      await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
      await user.clear(screen.getByDisplayValue('el gato'))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(screen.getByRole('alert')).toHaveTextContent('Title is required.')
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(calls).toHaveLength(1)
    })

    it('shows an error and stays in edit mode when saving fails', async () => {
      const user = userEvent.setup()
      mockFetch(async (_url, init) =>
        init?.method === 'PUT'
          ? new Response(null, { status: 500 })
          : jsonResponse([{ id: 1, title: 'el gato' }]),
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
              { id: 1, title: 'el gato' },
              { id: 2, title: 'la casa' },
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
          : jsonResponse([{ id: 1, title: 'el gato' }]),
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
          : jsonResponse([{ id: 1, title: 'el gato' }]),
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
})
