import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { trackEvent, trackException } from '../../telemetry'
import { api, card, cat, dog, pets } from '../support/factories'
import { emptyResponse, mockApi } from '../support/mockApi'
import {
  clickDelete,
  renderAt,
  renderLoaded,
  signInForEachTest,
} from '../support/render'

signInForEachTest()

describe('deleting a card', () => {
  it('removes the card from the list', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({
      'GET /flashcards': [cat, card(2, 'la casa', 'the house')],
      'DELETE /flashcards/1': emptyResponse(204),
    })
    renderAt('/')
    await screen.findByText('el gato')

    await clickDelete(user, 'Delete "el gato"', 'Delete "el gato"?')

    await waitFor(() => {
      expect(screen.queryByText('el gato')).not.toBeInTheDocument()
    })
    expect(screen.getByText('la casa')).toBeInTheDocument()
    expect(calls.find('DELETE')?.url).toBe(api('/flashcards/1'))
    expect(trackEvent).toHaveBeenCalledWith('FlashCardDeleted')
  })

  it('asks first, saying what is lost, and keeps the card when cancelled', async () => {
    const user = userEvent.setup()
    const { calls } = await renderLoaded('/', { 'GET /flashcards': [cat] })

    await user.click(screen.getByRole('button', { name: 'Delete "el gato"' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete "el gato"?',
    })
    expect(dialog).toHaveTextContent("This can't be undone.")
    expect(dialog).toHaveTextContent("All of the card's scores")
    expect(dialog).toHaveTextContent('every deck and tag')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByText('el gato')).toBeInTheDocument()
    expect(calls.some('DELETE')).toBe(false)
  })

  it('says so when there are no cards left', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /flashcards': [cat],
      'DELETE /flashcards/1': emptyResponse(204),
    })
    renderAt('/')
    await screen.findByText('el gato')

    await clickDelete(user, 'Delete "el gato"', 'Delete "el gato"?')

    expect(await screen.findByText('No flash cards yet.')).toBeInTheDocument()
  })

  it('shows an error and keeps the card when deleting fails', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /flashcards': [cat],
      'DELETE /flashcards/1': emptyResponse(500),
    })
    renderAt('/')
    await screen.findByText('el gato')

    await clickDelete(user, 'Delete "el gato"', 'Delete "el gato"?')

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
    { ...cat, tags: [pets] },
    { ...dog, tags: [pets] },
    card(3, 'la casa', 'the house'),
  ]

  function mockCards(deleteResponse: Response) {
    return mockApi({
      'GET /flashcards': threeCards,
      'GET /tags': [pets],
      'POST /flashcards/delete': deleteResponse,
    }).calls
  }

  it('deletes every card picked once the user says so', async () => {
    const user = userEvent.setup()
    const calls = mockCards(emptyResponse(204))
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
    const post = calls.find('POST')
    expect(post?.init?.body).toBe(JSON.stringify({ flashCardIds: [1, 2, 3] }))
    expect(trackEvent).toHaveBeenCalledWith('FlashCardsDeleted')
  })

  it('deletes nothing when the user cancels', async () => {
    const user = userEvent.setup()
    const calls = mockCards(emptyResponse(204))
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
    expect(calls.some('POST')).toBe(false)
    expect(screen.getByText('el gato')).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Pick "el gato"' }),
    ).toBeChecked()
  })

  it("only deletes the picked tag's cards", async () => {
    const user = userEvent.setup()
    const calls = mockCards(emptyResponse(204))
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
    expect(calls.find('POST')?.init?.body).toBe(
      JSON.stringify({ flashCardIds: [1, 2] }),
    )
  })

  it('keeps the cards and says why when deleting fails', async () => {
    const user = userEvent.setup()
    mockCards(emptyResponse(500))
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
