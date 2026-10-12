import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './fixtures'

// The backend started by playwright.config.ts.
const flashCardsApiUrl = 'http://localhost:5269/api/flashcards'

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
        data: { spanish: title, english: 'an accessibility check' },
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
