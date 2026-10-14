import AxeBuilder from '@axe-core/playwright'
import { test, expect, cardData, onePixelPng } from './fixtures'

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
    await expect(page.getByLabel('Loading', { exact: true })).toBeHidden()

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
        data: cardData(title, `${title} in English`),
      })
      expect(response.ok()).toBe(true)
      ids.push(((await response.json()) as { id: number }).id)
    }
    // One card with a picture, so the list's thumbnail and the edit form's picture get checked.
    const put = await request.put(`${flashCardsApiUrl}/${ids[1]}/image`, {
      data: onePixelPng,
    })
    expect(put.ok()).toBe(true)

    try {
      await page.goto('/')
      await expect(
        page.getByText('Another a11y card', { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('img', { name: 'Picture for "Another a11y card"' }),
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
      data: cardData(spanish, `${spanish} in English`),
    })
    expect(response.ok()).toBe(true)
    const { id } = (await response.json()) as { id: number }
    // With a picture, so the revealed card's picture gets checked (other specs' cards may come up instead).
    const put = await request.put(`${flashCardsApiUrl}/${id}/image`, {
      data: onePixelPng,
    })
    expect(put.ok()).toBe(true)

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

  test("decks list, a deck's page with a card picked, the new deck dialog and the Tags page have no detectable accessibility violations", async ({
    page,
    request,
  }) => {
    const card = await request.post(flashCardsApiUrl, {
      data: cardData(`A11y deck card ${Date.now()}`, 'a check', ['A11y']),
    })
    expect(card.ok()).toBe(true)
    const { id: cardId } = (await card.json()) as { id: number }
    const name = `A11y deck ${Date.now()}`
    const deck = await request.post(decksApiUrl, {
      data: { name, flashCardIds: [cardId] },
    })
    expect(deck.ok()).toBe(true)
    const { id: deckId } = (await deck.json()) as { id: number }

    // Checked once nothing is fading in or out, since a button part way from disabled to enabled can fail on
    // contrast.
    async function violations() {
      await page.waitForFunction(() => document.getAnimations().length === 0)
      return (await new AxeBuilder({ page }).analyze()).violations
    }

    try {
      await page.goto('/decks')
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
      expect(await violations()).toEqual([])

      await page.getByRole('link', { name, exact: true }).click()
      await page
        .getByRole('checkbox', { name: /^Pick "A11y deck card/ })
        .check()
      await expect(
        page.getByRole('button', { name: 'Remove 1 card from deck' }),
      ).toBeEnabled()
      expect(await violations()).toEqual([])

      await page.goto('/')
      await page
        .getByRole('checkbox', { name: /^Pick "A11y deck card/ })
        .check()
      await page.getByRole('button', { name: 'Add 1 card to deck…' }).click()
      await page.getByRole('menuitem', { name: 'New deck…' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(await violations()).toEqual([])

      // The Tags page, with a tag being renamed.
      await page.goto('/tags')
      await page.getByRole('button', { name: 'Rename tag "A11y"' }).click()
      await expect(page.getByLabel('Tag name', { exact: true })).toBeFocused()
      expect(await violations()).toEqual([])
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
      data: cardData(spanish, `${spanish} in English`),
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
