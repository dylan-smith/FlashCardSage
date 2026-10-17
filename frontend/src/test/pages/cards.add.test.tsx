import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { trackEvent, trackException } from '../../telemetry'
import { api, card, cat } from '../support/factories'
import { emptyResponse, jsonResponse, mockApi } from '../support/mockApi'
import { renderAt, renderLoaded, signInForEachTest } from '../support/render'

signInForEachTest()

describe('adding a card', () => {
  it('sends both trimmed sides, adds the card to the list and clears the inputs', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({
      'POST /flashcards': jsonResponse({ ...cat, id: 7 }, 201),
    })
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
    const post = calls.find('POST')
    expect(post?.url).toBe(api('/flashcards'))
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
    // Typing in a side asks for a translation too, which isn't available.
    const { calls } = mockApi({
      'POST /flashcards': jsonResponse(
        card(7, ['solo', 'únicamente'], 'only'),
        201,
      ),
    })
    renderAt('/')
    await screen.findByText('No flash cards yet.')

    await user.type(screen.getByLabelText('Spanish', { exact: false }), 'solo')
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
    await user.type(screen.getByLabelText('English', { exact: false }), 'only')
    await user.click(screen.getByRole('button', { name: 'Add flash card' }))

    expect(await screen.findByText('solo / únicamente')).toBeInTheDocument()
    expect(screen.getByText('only')).toBeInTheDocument()
    // The form goes back to one field for each side.
    expect(screen.queryByLabelText('Spanish 2')).not.toBeInTheDocument()
    const post = calls.find('POST', '/flashcards')
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
    const { calls } = await renderLoaded('/')
    const input = screen.getByLabelText('Spanish', { exact: false })
    // The field is required, so submit the form around it rather than clicking the button.
    input.removeAttribute('required')

    await user.type(input, '   ')
    await user.type(screen.getByLabelText('English', { exact: false }), 'x')
    await user.click(screen.getByRole('button', { name: 'Add flash card' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Spanish is required.')
    expect(calls.all.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('asks for the English instead of sending a blank one', async () => {
    const user = userEvent.setup()
    const { calls } = await renderLoaded('/')
    const input = screen.getByLabelText('English', { exact: false })
    input.removeAttribute('required')

    await user.type(screen.getByLabelText('Spanish', { exact: false }), 'x')
    await user.type(input, '   ')
    await user.click(screen.getByRole('button', { name: 'Add flash card' }))

    expect(screen.getByRole('alert')).toHaveTextContent('English is required.')
    expect(calls.all.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it("shows the API's reason when it rejects the card", async () => {
    const user = userEvent.setup()
    mockApi({
      'POST /flashcards': jsonResponse(
        { errors: { English: ['English is required.'] } },
        400,
      ),
    })
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
    mockApi({
      'GET /flashcards': [cat],
      'POST /flashcards': jsonResponse(
        { detail: 'You already have a flash card with this Spanish.' },
        409,
      ),
    })
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
    mockApi({ 'POST /flashcards': emptyResponse(500) })
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
