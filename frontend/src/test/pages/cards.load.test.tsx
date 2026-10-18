import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { tagline } from '../../components/layout/Brand'
import { unreachableMessage } from '../../api/client'
import { trackException } from '../../telemetry'
import { cat, dog } from '../support/factories'
import { emptyResponse, mockApi, unreachable } from '../support/mockApi'
import {
  renderAt,
  renderLoaded,
  signInForEachTest,
  stubMatchMedia,
} from '../support/render'

signInForEachTest()

describe('static content', () => {
  it('renders the logo, tagline and the form', async () => {
    await renderLoaded('/')

    expect(
      screen.getByRole('heading', { level: 1, name: 'FlashCardSage' }),
    ).toBeInTheDocument()
    expect(screen.getByText(tagline)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'FlashCardSage' })).toHaveAttribute(
      'href',
      '/',
    )
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
    const { calls } = mockApi()

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
    expect(calls.all).toEqual([])
  })
})

describe('loading the list', () => {
  it('shows a loading state, then the cards in order', async () => {
    mockApi({ 'GET /flashcards': [cat, dog] })

    renderAt('/')

    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
    const items = await screen.findAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'el gatothe cat',
      'el perrothe dog',
    ])
    expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
    expect(
      new Headers(
        (vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers,
      ).get('Authorization'),
    ).toBe('Bearer test:Tester')
  })

  it('collapses each card open and shut as the list changes, keeping it a list of items', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /flashcards': [cat] })
    renderAt('/')

    // The item that collapses is the list's own <li>, with the card inside it, so a screen reader still sees a
    // list of one item per card.
    const [item] = await screen.findAllByRole('listitem')
    expect(item.tagName).toBe('LI')
    expect(item).toHaveClass('MuiCollapse-root')
    expect(item.parentElement?.tagName).toBe('UL')
    expect(within(item).queryByRole('listitem')).not.toBeInTheDocument()

    // The form takes the row's place as an item of its own, so the row shrinks away as the form grows.
    await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
    const [form] = screen.getAllByRole('listitem')
    expect(form).not.toBe(item)
    expect(within(form).getByLabelText('Spanish')).toHaveValue('el gato')
    await waitFor(() => expect(item).not.toBeInTheDocument())
    expect(screen.getAllByRole('listitem')).toEqual([form])
  })

  it("shows each card's buttons as text on a wide screen", async () => {
    // A screen at least as wide as the sm breakpoint.
    stubMatchMedia((query) => query.includes('min-width:600px'))
    await renderLoaded('/', { 'GET /flashcards': [cat] })

    expect(screen.getByRole('listitem')).toHaveTextContent(
      'el gatothe catEditDelete',
    )
  })

  it("shows each card's buttons as icons on a phone, with a tooltip that says what they do", async () => {
    const user = userEvent.setup()
    await renderLoaded('/', { 'GET /flashcards': [cat] })

    await user.hover(screen.getByRole('button', { name: 'Edit "el gato"' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Edit')
    await user.hover(screen.getByRole('button', { name: 'Delete "el gato"' }))
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent('Delete'),
    )
  })

  it('says so when there are no cards', async () => {
    await renderLoaded('/')

    expect(screen.getByText('No flash cards yet.')).toBeInTheDocument()
  })

  it('shows an error when loading fails', async () => {
    mockApi({ 'GET /flashcards': emptyResponse(500) })

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
    mockApi({ 'GET /flashcards': unreachable })

    renderAt('/')

    expect(await screen.findByText(unreachableMessage)).toBeInTheDocument()
    expect(trackException).toHaveBeenCalledWith(expect.any(TypeError), {
      operation: 'load',
    })
  })
})
