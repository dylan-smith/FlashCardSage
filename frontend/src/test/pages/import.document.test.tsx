import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Deck } from '../../api/decks'
import { documentDeckName } from '../../lib/documentDeckName'
import { trackException } from '../../telemetry'
import { api, card, deck } from '../support/factories'
import { emptyResponse, jsonResponse, mockApi } from '../support/mockApi'
import type { Routes } from '../support/mockApi'
import { renderAt, signInForEachTest } from '../support/render'

signInForEachTest()

describe('importing from a document', () => {
  const lessonDeck = deck(50, 'Lección 3')

  // Shows the document's tab and scans "Lección 3.docx", which finds two cards. Saving anything else is answered from
  // routes. The other tabs' lists are empty.
  async function scanLesson(routes: Routes, decks: Deck[] = []) {
    const user = userEvent.setup()
    const { calls } = mockApi({
      'GET /decks': decks,
      'POST /document-scans': {
        candidates: [
          { spanish: 'nadar', english: 'to swim' },
          { spanish: 'correr', english: 'to run' },
        ],
        truncated: false,
      },
      ...routes,
    })
    renderAt('/import?from=document')
    await user.upload(
      screen.getByLabelText('Choose a document'),
      new File(['Nadar y correr.'], 'Lección 3.docx'),
    )
    const list = await screen.findByRole('list', {
      name: 'Cards from the document',
    })
    return { user, calls, list }
  }

  it('names the deck after the document, without its extension', () => {
    expect(documentDeckName('Lección 3.docx')).toBe('Lección 3')
    expect(documentDeckName('notes.from.class.txt')).toBe('notes.from.class')
    expect(documentDeckName('README')).toBe('README')
    expect(documentDeckName('.txt')).toBe('.txt')
    // Cut to the longest a deck name can be.
    expect(documentDeckName(`${'a'.repeat(60)}.pdf`)).toBe('a'.repeat(50))
  })

  it('adds one card to a new deck named after the document', async () => {
    const { user, calls, list } = await scanLesson({
      'POST /flashcards': jsonResponse(card(8, 'nadar', 'to swim'), 201),
      'POST /decks': jsonResponse({ ...lessonDeck, flashCardIds: [8] }, 201),
    })

    await user.click(within(list).getByRole('button', { name: 'Add "nadar"' }))

    expect(
      await screen.findByText('Added “nadar” to your Lección 3 deck.'),
    ).toBeInTheDocument()
    const posts = calls
      .filter('POST')
      .filter((call) => call.pathname !== '/document-scans')
    expect(posts.map((call) => call.url)).toEqual([
      api('/flashcards'),
      api('/decks'),
    ])
    expect(JSON.parse(posts[0].init?.body as string)).toEqual({
      spanish: ['nadar'],
      english: ['to swim'],
      tags: [],
      source: 'Document',
    })
    expect(JSON.parse(posts[1].init?.body as string)).toEqual({
      name: 'Lección 3',
      flashCardIds: [8],
    })
  })

  it('adds all the cards to the deck the user has with the document’s name', async () => {
    const { user, calls } = await scanLesson(
      {
        'POST /flashcards/batch': {
          cards: [card(8, 'nadar', 'to swim'), card(9, 'correr', 'to run')],
          skippedCount: 0,
        },
        'PATCH /decks/50/cards': { ...lessonDeck, flashCardIds: [5, 8, 9] },
      },
      [{ ...lessonDeck, name: 'lección 3', flashCardIds: [5] }],
    )

    await user.click(
      screen.getAllByRole('button', { name: 'Add all 2 cards' })[0],
    )

    expect(
      await screen.findByText(
        'Added 2 cards from “Lección 3.docx” to your Lección 3 deck.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open deck' })).toHaveAttribute(
      'href',
      '/decks/50',
    )
    const batch = calls.find('POST', '/flashcards/batch')
    expect(JSON.parse(batch?.init?.body as string)).toMatchObject({
      source: 'Document',
    })
    // The cards go in the deck the user already has, whatever its case.
    const patch = calls.find('PATCH')
    expect(patch?.url).toBe(api('/decks/50/cards'))
    expect(JSON.parse(patch?.init?.body as string)).toEqual({
      add: [8, 9],
      remove: [],
    })
  })

  it("says when the cards were added but couldn't be put in the deck", async () => {
    const { user } = await scanLesson({
      'POST /flashcards/batch': {
        cards: [card(8, 'nadar', 'to swim'), card(9, 'correr', 'to run')],
        skippedCount: 0,
      },
      'POST /decks': emptyResponse(500),
    })

    await user.click(
      screen.getAllByRole('button', { name: 'Add all 2 cards' })[0],
    )

    expect(
      await screen.findByText(
        "The cards were added, but couldn't be put in your Lección 3 deck.",
      ),
    ).toBeInTheDocument()
    // With a link to the cards instead.
    expect(screen.getByRole('link', { name: 'View cards' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'documentDeck',
    })
  })
})
