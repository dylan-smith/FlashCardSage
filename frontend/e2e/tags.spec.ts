import type { Page } from '@playwright/test'
import { test, expect, addCard, confirmDelete, openSection } from './fixtures'

test.describe('Tags', () => {
  test.beforeEach(async ({ page, api }) => {
    // Start with no cards or tags.
    await api.reset('flashcards', 'tags')

    await page.goto('/')
    await expect(page.getByText('No flash cards yet.')).toBeVisible()
  })

  test('tags cards and shows only the picked tag', async ({ page }) => {
    await addCard(page, 'lunes', 'Monday', ['Weekdays'])
    await addCard(page, 'enero', 'January', ['Months'])
    await addCard(page, 'martes', 'Tuesday', ['weekdays'])

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

  test('suggests a tag for a new card', async ({ page, api }) => {
    await addCard(page, 'lunes', 'Monday', ['Weekdays'])
    // The E2E backend has no Foundry endpoint or key, so stand in for the model, picking the user's tag.
    const tags = await api.list<{ id: number; name: string }>('tags')
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
    await addCard(page, 'la manzana', 'the apple', ['Food'])

    await page.getByRole('button', { name: 'Edit "la manzana"' }).click()
    const item = page.getByRole('listitem')
    // Typed in without pressing Enter, the tag is still added when the card is saved.
    await item.getByRole('combobox', { name: 'Tags' }).fill('Fruit')
    await item.getByRole('button', { name: 'Save' }).click()

    // The form shrinks away as the saved card takes its place, and shows the tag too until it has gone.
    await expect(item.getByRole('combobox', { name: 'Tags' })).toHaveCount(0)
    await expect(item.getByText('Fruit', { exact: true })).toBeVisible()
    await page.reload()
    await expect(item.getByText('Food', { exact: true })).toBeVisible()
    await expect(item.getByText('Fruit', { exact: true })).toBeVisible()
  })

  // Tags are renamed and deleted on the Tags page, under Manage cards.
  async function goToTags(page: Page) {
    await openSection(page, 'Tags')
    await expect(
      page.getByRole('heading', { name: 'Tags', exact: true }),
    ).toBeVisible()
  }

  test('adds a suggested tag', async ({ page }) => {
    // The E2E backend has no Foundry endpoint or key, so stand in for the model.
    await page.route('**/api/tag-suggestions/new', async (route) => {
      await route.fulfill({ json: ['Animals', 'Colors'] })
    })
    await goToTags(page)

    await page.getByRole('button', { name: 'Add tag "Animals"' }).click()

    await expect(page.getByRole('link', { name: 'Animals' })).toBeVisible()
    const suggested = page.getByRole('list', { name: 'Suggested tags' })
    await expect(suggested.getByRole('listitem')).toHaveCount(1)
    await expect(suggested).toContainText('Colors')
    await page.unroute('**/api/tag-suggestions/new')
    await page.reload()
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Animals' }),
    ).toContainText('0 cards')
  })

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
    await addCard(page, 'el tren', 'the train', ['Travl'])
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
    await addCard(page, 'el pan', 'the bread', ['Food'])
    await goToTags(page)

    await page.getByRole('button', { name: 'Delete tag "Food"' }).click()
    await confirmDelete(page, 'Delete tag "Food"?')

    await expect(page.getByRole('link', { name: 'Food' })).toBeHidden()
    await openSection(page, /^Cards( \d+)?$/)
    await expect(page.getByText('el pan', { exact: true })).toBeVisible()
    await expect(page.getByText('Food', { exact: true })).toBeHidden()
  })

  test('replaces a deleted tag with another', async ({ page }) => {
    await addCard(page, 'el gato', 'the cat', ['Animal'])
    await addCard(page, 'el perro', 'the dog', ['Animals'])
    await goToTags(page)

    await page.getByRole('button', { name: 'Delete tag "Animal"' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete tag "Animal"?' })
    await dialog.getByRole('combobox', { name: 'Replace with' }).click()
    await page.getByRole('option', { name: 'Animals' }).click()
    await dialog.getByRole('button', { name: 'Delete' }).click()

    await expect(
      page.getByRole('link', { name: 'Animal', exact: true }),
    ).toBeHidden()
    const item = page.getByRole('listitem').filter({ hasText: 'Animals' })
    await expect(item).toContainText('2 cards')
    await page.reload()
    await expect(item).toContainText('2 cards')
  })
})
