import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { trackEvent, trackException } from '../../telemetry'
import { api, card, cat, dog } from '../support/factories'
import { emptyResponse, jsonResponse, mockApi } from '../support/mockApi'
import { renderAt, renderLoaded, signInForEachTest } from '../support/render'

signInForEachTest()

describe('editing a card', () => {
  it('saves both changed sides', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({
      'GET /flashcards': [cat, card(2, 'la casa', 'the house')],
      'PUT /flashcards/1': card(1, 'el perro', 'the dog'),
    })
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
    const put = calls.find('PUT')
    expect(put?.url).toBe(api('/flashcards/1'))
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
    const { calls } = mockApi({
      'GET /flashcards': [card(1, ['solo', 'únicamente'], 'only')],
      'PUT /flashcards/1': card(1, ['únicamente', 'sólo'], ['only', 'just']),
    })
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
    const put = calls.find('PUT')
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
    const { calls } = mockApi({
      'GET /flashcards': [card(1, ['solo', 'únicamente'], 'only')],
      'PUT /flashcards/1': card(1, 'solo', 'only'),
    })
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
    const put = calls.find('PUT')
    expect(put?.init?.body).toBe(
      JSON.stringify({ spanish: ['solo'], english: ['only'], tags: [] }),
    )
  })

  it('can be cancelled, keeping the old card', async () => {
    const user = userEvent.setup()
    const { calls } = await renderLoaded('/', { 'GET /flashcards': [cat] })

    await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
    const input = screen.getByDisplayValue('el gato')
    await user.clear(input)
    await user.type(input, 'changed')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('el gato')).toBeInTheDocument()
    expect(screen.queryByText('changed')).not.toBeInTheDocument()
    expect(calls.all.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('asks for the English instead of saving a blank one', async () => {
    const user = userEvent.setup()
    const { calls } = await renderLoaded('/', { 'GET /flashcards': [cat] })

    await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
    await user.clear(screen.getByDisplayValue('the cat'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent('English is required.')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(calls.all.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('stays in edit mode when the change would duplicate another card', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /flashcards': [cat, dog],
      'PUT /flashcards/1': jsonResponse(
        { detail: 'You already have a flash card with this English.' },
        409,
      ),
    })
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
    mockApi({
      'GET /flashcards': [cat],
      'PUT /flashcards/1': emptyResponse(500),
    })
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
