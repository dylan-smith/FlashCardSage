import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

// The backend started by playwright.config.ts.
const apiUrl = 'http://localhost:5269/api'

// Adds a flash card with these tags from the form and waits for it to appear in the list.
async function createFlashCard(
  page: Page,
  spanish: string,
  english: string,
  tags: string[],
) {
  await page.getByLabel('Spanish').fill(spanish)
  await page.getByLabel('English').fill(english)
  const tagsInput = page.getByRole('combobox', { name: 'Tags' })
  for (const tag of tags) {
    await tagsInput.fill(tag)
    await tagsInput.press('Enter')
  }
  await page.getByRole('button', { name: 'Add flash card' }).click()
  await expect(
    page.getByRole('listitem').filter({ hasText: spanish }),
  ).toBeVisible()
}

test.describe('Tags', () => {
  test.beforeEach(async ({ page, request }) => {
    // Start with no cards or tags, deleted through the API like flashcards.spec.ts does.
    for (const resource of ['flashcards', 'tags']) {
      const response = await request.get(`${apiUrl}/${resource}`)
      expect(response.ok()).toBe(true)
      for (const { id } of (await response.json()) as { id: number }[]) {
        expect((await request.delete(`${apiUrl}/${resource}/${id}`)).ok()).toBe(
          true,
        )
      }
    }

    await page.goto('/')
    await expect(page.getByText('No flash cards yet.')).toBeVisible()
  })

  test('tags cards and shows only the picked tag', async ({ page }) => {
    await createFlashCard(page, 'lunes', 'Monday', ['Weekdays'])
    await createFlashCard(page, 'enero', 'January', ['Months'])
    await createFlashCard(page, 'martes', 'Tuesday', ['weekdays'])

    const filter = page.getByRole('group', { name: 'Show cards tagged' })
    await expect(filter.getByRole('button')).toHaveText([
      'All (3)',
      'Months (1)',
      'Weekdays (2)',
    ])

    await filter.getByRole('button', { name: 'Weekdays (2)' }).click()

    const items = page.getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('lunes')
    await expect(items.nth(1)).toContainText('martes')
    await expect(page).toHaveURL(/\?tag=\d+$/)

    // The filter is in the address, so it's kept after a reload.
    await page.reload()
    await expect(items).toHaveCount(2)

    await filter.getByRole('button', { name: 'All (3)' }).click()
    await expect(items).toHaveCount(3)
  })

  test('suggests a tag for a new card', async ({ page, request }) => {
    await createFlashCard(page, 'lunes', 'Monday', ['Weekdays'])
    // The E2E backend has no Foundry endpoint or key, so stand in for the model, picking the user's tag.
    const tags = (await (await request.get(`${apiUrl}/tags`)).json()) as {
      id: number
      name: string
    }[]
    await page.route('**/api/tag-suggestions', async (route) => {
      await route.fulfill({ json: tags })
    })

    await page.getByLabel('Spanish').fill('martes')
    await page.getByLabel('English').fill('Tuesday')
    await page.getByRole('button', { name: 'Add tag Weekdays' }).click()
    await expect(
      page.getByRole('button', { name: 'Add tag Weekdays' }),
    ).toBeHidden()
    await page.getByRole('button', { name: 'Add flash card' }).click()

    await expect(
      page
        .getByRole('group', { name: 'Show cards tagged' })
        .getByRole('button', { name: 'Weekdays (2)' }),
    ).toBeVisible()
  })

  test("changes a card's tags", async ({ page }) => {
    await createFlashCard(page, 'la manzana', 'the apple', ['Food'])

    await page.getByRole('button', { name: 'Edit "la manzana"' }).click()
    const item = page.getByRole('listitem')
    // Typed in without pressing Enter, the tag is still added when the card is saved.
    await item.getByRole('combobox', { name: 'Tags' }).fill('Fruit')
    await item.getByRole('button', { name: 'Save' }).click()

    await expect(item.getByText('Fruit', { exact: true })).toBeVisible()
    await page.reload()
    await expect(item.getByText('Food', { exact: true })).toBeVisible()
    await expect(item.getByText('Fruit', { exact: true })).toBeVisible()
  })

  // Tags are renamed and deleted on the Tags page, under Manage cards.
  async function goToTags(page: Page) {
    await page
      .getByRole('navigation', { name: 'Manage cards' })
      .getByRole('link', { name: 'Tags' })
      .click()
    await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible()
  }

  test('creates a tag with no cards', async ({ page }) => {
    await goToTags(page)

    await page.getByLabel('New tag name').fill('Animals')
    await page.getByRole('button', { name: 'Create tag' }).click()

    const item = page.getByRole('listitem').filter({ hasText: 'Animals' })
    await expect(item).toContainText('0 cards')
    await page.reload()
    await expect(item).toContainText('0 cards')
  })

  test('renames a tag', async ({ page }) => {
    await createFlashCard(page, 'el tren', 'the train', ['Travl'])
    await goToTags(page)

    await page.getByRole('button', { name: 'Rename tag "Travl"' }).click()
    await page.getByLabel('Tag name', { exact: true }).fill('Travel')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByRole('link', { name: 'Travel' })).toBeVisible()
    await page.getByRole('link', { name: 'Travel' }).click()
    await expect(page).toHaveURL(/\/\?tag=\d+$/)
    await expect(
      page.getByRole('button', { name: 'Travel (1)' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('listitem').getByText('Travel', { exact: true }),
    ).toBeVisible()
  })

  test('deletes a tag but keeps its cards', async ({ page }) => {
    await createFlashCard(page, 'el pan', 'the bread', ['Food'])
    await goToTags(page)

    await page.getByRole('button', { name: 'Delete tag "Food"' }).click()
    await page
      .getByRole('dialog', { name: 'Delete tag "Food"?' })
      .getByRole('button', { name: 'Delete' })
      .click()

    await expect(page.getByRole('link', { name: 'Food' })).toBeHidden()
    await page
      .getByRole('navigation', { name: 'Manage cards' })
      .getByRole('link', { name: /^Cards( \d+)?$/ })
      .click()
    await expect(page.getByText('el pan', { exact: true })).toBeVisible()
    await expect(page.getByText('Food', { exact: true })).toBeHidden()
  })
})
