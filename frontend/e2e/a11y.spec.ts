import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './fixtures'

// The backend started by playwright.config.ts.
const flashCardsApiUrl = 'http://localhost:5269/api/flashcards'
const decksApiUrl = 'http://localhost:5269/api/decks'

test.describe('Accessibility', () => {
  test('main page has no detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'FlashCardSage' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Add flash card' }),
    ).toBeVisible()
    await expect(page.getByLabel('Loading')).toBeHidden()

    const results = await new AxeBuilder({ page }).analyze()

    expect(results.violations).toEqual([])
  })

  test('the list, with a card being edited, has no detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const ids: number[] = []
    for (const title of [`A11y card ${Date.now()}`, 'Another a11y card']) {
      const response = await request.post(flashCardsApiUrl, {
        data: { spanish: title, english: `${title} in English` },
      })
      expect(response.ok()).toBe(true)
      ids.push(((await response.json()) as { id: number }).id)
    }

    try {
      await page.goto('/')
      await expect(
        page.getByText('Another a11y card', { exact: true }),
      ).toBeVisible()
      // One card in edit mode and one not, so both kinds of list item get checked.
      await page
        .getByRole('button', { name: 'Edit "Another a11y card"' })
        .click()
      await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()

      const results = await new AxeBuilder({ page }).analyze()

      expect(results.violations).toEqual([])
    } finally {
      for (const id of ids) {
        await request.delete(`${flashCardsApiUrl}/${id}`)
      }
    }
  })

  test('practice page, with a card revealed, has no detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const spanish = `A11y practice ${Date.now()}`
    const response = await request.post(flashCardsApiUrl, {
      data: { spanish, english: `${spanish} in English` },
    })
    expect(response.ok()).toBe(true)
    const { id } = (await response.json()) as { id: number }

    try {
      await page.goto('/practice')
      await page.getByRole('button', { name: 'Reveal' }).click()
      await expect(page.getByRole('button', { name: 'Got it!' })).toBeVisible()

      const results = await new AxeBuilder({ page }).analyze()

      expect(results.violations).toEqual([])
    } finally {
      await request.delete(`${flashCardsApiUrl}/${id}`)
    }
  })

  test('decks page, with a deck being edited, has no detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const card = await request.post(flashCardsApiUrl, {
      data: {
        spanish: `A11y deck card ${Date.now()}`,
        english: 'a check',
        tags: ['A11y'],
      },
    })
    expect(card.ok()).toBe(true)
    const { id: cardId } = (await card.json()) as { id: number }
    const name = `A11y deck ${Date.now()}`
    const deck = await request.post(decksApiUrl, {
      data: { name, flashCardIds: [cardId] },
    })
    expect(deck.ok()).toBe(true)
    const { id: deckId } = (await deck.json()) as { id: number }

    try {
      await page.goto('/decks')
      // Editing shows the picked card's chip as well as the deck in the list.
      await page.getByRole('button', { name: `Edit deck "${name}"` }).click()
      await expect(
        page.getByRole('button', { name: 'Save deck' }),
      ).toBeVisible()

      const results = await new AxeBuilder({ page }).analyze()

      expect(results.violations).toEqual([])
    } finally {
      await request.delete(`${decksApiUrl}/${deckId}`)
      await request.delete(`${flashCardsApiUrl}/${cardId}`)
    }
  })

  test('scores page has no detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const spanish = `A11y scores ${Date.now()}`
    const response = await request.post(flashCardsApiUrl, {
      data: { spanish, english: `${spanish} in English` },
    })
    expect(response.ok()).toBe(true)
    const { id } = (await response.json()) as { id: number }

    try {
      expect(
        (
          await request.post(`${flashCardsApiUrl}/${id}/practice-results`, {
            data: { outcome: 'GotIt' },
          })
        ).ok(),
      ).toBe(true)
      await page.goto('/scores')
      await expect(page.getByText(spanish, { exact: true })).toBeVisible()

      const results = await new AxeBuilder({ page }).analyze()

      expect(results.violations).toEqual([])
    } finally {
      await request.delete(`${flashCardsApiUrl}/${id}`)
    }
  })

  test('not found page has no detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/no/such/page')
    await expect(
      page.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()

    expect(results.violations).toEqual([])
  })
})
