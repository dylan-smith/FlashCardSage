import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { saveFile } from '../../lib/saveFile'
import { trackEvent } from '../../telemetry'
import { api, cat, deck, dog } from '../support/factories'
import { jsonResponse, mockApi } from '../support/mockApi'
import type { Routes } from '../support/mockApi'
import { renderAt, signInForEachTest, waitForLoaded } from '../support/render'

vi.mock('../../lib/saveFile', () => ({ saveFile: vi.fn() }))

signInForEachTest()

describe('sharing decks as files', () => {
  const animals = deck(7, 'Animals', [1, 2])

  async function showPage(path: string, routes: Routes = {}) {
    const mock = mockApi({
      'GET /flashcards': [cat, dog],
      'GET /decks': [animals],
      'GET /decks/:id': animals,
      ...routes,
    })
    renderAt(path)
    await waitForLoaded()
    return mock.calls
  }

  it('exports a deck as a .yml file', async () => {
    const user = userEvent.setup()
    const calls = await showPage('/decks/7', {
      'GET /decks/7/export': new Response('name: Animals\n', {
        headers: { 'Content-Type': 'application/yaml' },
      }),
    })

    await user.click(screen.getByRole('button', { name: 'Export' }))

    await vi.waitFor(() => {
      expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'Animals.yml')
    })
    expect(calls.find('GET', '/decks/7/export')?.url).toBe(
      api('/decks/7/export'),
    )
    expect(trackEvent).toHaveBeenCalledWith('DeckExported')
  })

  it('exports a deck with pictures of the user’s own as a .zip file', async () => {
    const user = userEvent.setup()
    await showPage('/decks/7', {
      'GET /decks/7/export': new Response('PK', {
        headers: { 'Content-Type': 'application/zip' },
      }),
    })

    await user.click(screen.getByRole('button', { name: 'Export' }))

    await vi.waitFor(() => {
      expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'Animals.zip')
    })
  })

  it('can’t export a deck with no cards', async () => {
    await showPage('/decks/8', { 'GET /decks/:id': deck(8, 'Empty') })

    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })

  it('imports a deck file and opens the new deck, saying what it did', async () => {
    const user = userEvent.setup()
    const lesson = deck(9, 'Lesson 3', [1, 2])
    const calls = await showPage('/decks', {
      'GET /decks/:id': lesson,
      'POST /decks/import': jsonResponse(
        {
          deck: lesson,
          importedCount: 1,
          existingCount: 1,
          skippedCount: 0,
          missingPictureCount: 2,
        },
        201,
      ),
    })
    const file = new File(['name: Lesson 3'], 'Lesson 3.yml')

    await user.upload(screen.getByLabelText('Import a deck file'), file)

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Lesson 3' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(
        "Imported Lesson 3 with 2 cards. You already had 1 of them. 2 pictures aren't on this site, so their cards have none.",
      ),
    ).toBeInTheDocument()
    const body = calls.find('POST', '/decks/import')?.body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('file')).toBe(file)
    expect(trackEvent).toHaveBeenCalledWith('DeckFileImported')
  })

  it('shows why the API refused a deck file', async () => {
    const user = userEvent.setup()
    await showPage('/decks', {
      'POST /decks/import': jsonResponse(
        { errors: { file: ['Card 2: English is required.'] } },
        400,
      ),
    })

    await user.upload(
      screen.getByLabelText('Import a deck file'),
      new File(['name: Lesson 3'], 'Lesson 3.yml'),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Card 2: English is required.',
    )
    expect(
      screen.getByRole('heading', { level: 2, name: 'Decks' }),
    ).toBeInTheDocument()
  })
})
