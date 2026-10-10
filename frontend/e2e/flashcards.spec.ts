import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

// The backend started by playwright.config.ts.
const flashCardsApiUrl = 'http://localhost:5269/api/flashcards'

// Adds a flash card from the form and waits for it to appear in the list.
async function createFlashCard(page: Page, title: string) {
  await page.getByLabel('Title').fill(title)
  await page.getByRole('button', { name: 'Add flash card' }).click()
  await expect(
    page.getByRole('listitem').filter({ hasText: title }),
  ).toBeVisible()
}

test.describe('Flash card management', () => {
  test.beforeEach(async ({ page, request }) => {
    // Delete leftover cards (including ones other spec files created) through the API, since deleting them in
    // the UI races the page's initial load.
    const response = await request.get(flashCardsApiUrl)
    expect(response.ok()).toBe(true)
    for (const { id } of (await response.json()) as { id: number }[]) {
      expect((await request.delete(`${flashCardsApiUrl}/${id}`)).ok()).toBe(
        true,
      )
    }

    // Wait for the initial load to finish, so its response can't overwrite a list the test changes.
    await page.goto('/')
    await expect(page.getByText('No flash cards yet.')).toBeVisible()
  })

  test.describe('Add flash card', () => {
    test('adds a new card', async ({ page }) => {
      await createFlashCard(page, 'el gato')
    })

    test('trims whitespace from the title', async ({ page }) => {
      await page.getByLabel('Title').fill('  el perro  ')
      await page.getByRole('button', { name: 'Add flash card' }).click()

      await expect(page.getByText('el perro', { exact: true })).toBeVisible()
    })

    test('clears the input after adding a card', async ({ page }) => {
      await createFlashCard(page, 'la casa')
      await expect(page.getByLabel('Title')).toHaveValue('')
    })

    test('lists cards in the order they were added', async ({ page }) => {
      await createFlashCard(page, 'uno')
      await createFlashCard(page, 'dos')
      await createFlashCard(page, 'tres')

      const items = page.getByRole('listitem')
      await expect(items).toHaveCount(3)
      await expect(items.nth(0)).toContainText('uno')
      await expect(items.nth(1)).toContainText('dos')
      await expect(items.nth(2)).toContainText('tres')
    })

    test('keeps the cards after a reload', async ({ page }) => {
      await createFlashCard(page, 'el libro')

      await page.reload()

      await expect(page.getByText('el libro', { exact: true })).toBeVisible()
    })
  })

  test.describe('Edit flash card', () => {
    test('changes the title', async ({ page }) => {
      await createFlashCard(page, 'el gato')

      await page.getByRole('button', { name: 'Edit "el gato"' }).click()
      const input = page.getByRole('listitem').getByLabel('Title')
      await expect(input).toHaveValue('el gato')
      await input.fill('  el perro  ')
      await page.getByRole('button', { name: 'Save' }).click()

      await expect(page.getByText('el perro', { exact: true })).toBeVisible()
      await expect(page.getByText('el gato', { exact: true })).toBeHidden()
      await expect(page.getByRole('button', { name: 'Save' })).toBeHidden()
      await page.reload()
      await expect(page.getByText('el perro', { exact: true })).toBeVisible()
    })

    test('saves with Enter', async ({ page }) => {
      await createFlashCard(page, 'el gato')

      await page.getByRole('button', { name: 'Edit "el gato"' }).click()
      const input = page.getByRole('listitem').getByLabel('Title')
      await input.fill('la gata')
      await input.press('Enter')

      await expect(page.getByText('la gata', { exact: true })).toBeVisible()
    })

    test('can be cancelled', async ({ page }) => {
      await createFlashCard(page, 'el gato')

      await page.getByRole('button', { name: 'Edit "el gato"' }).click()
      await page.getByRole('listitem').getByLabel('Title').fill('changed')
      await page.getByRole('button', { name: 'Cancel' }).click()

      await expect(page.getByText('el gato', { exact: true })).toBeVisible()
      await expect(page.getByText('changed', { exact: true })).toBeHidden()
    })

    test('refuses a blank title', async ({ page }) => {
      await createFlashCard(page, 'el gato')

      await page.getByRole('button', { name: 'Edit "el gato"' }).click()
      await page.getByRole('listitem').getByLabel('Title').fill('   ')
      await page.getByRole('button', { name: 'Save' }).click()

      await expect(page.getByRole('alert')).toHaveText('Title is required.')
      await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
    })
  })

  test.describe('Delete flash card', () => {
    test('removes the card', async ({ page }) => {
      await createFlashCard(page, 'el gato')
      await createFlashCard(page, 'el perro')

      await page.getByRole('button', { name: 'Delete "el gato"' }).click()

      await expect(page.getByText('el gato', { exact: true })).toBeHidden()
      await expect(page.getByText('el perro', { exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByText('el gato', { exact: true })).toBeHidden()
      await expect(page.getByText('el perro', { exact: true })).toBeVisible()
    })

    test('shows the empty message once the last card is gone', async ({
      page,
    }) => {
      await createFlashCard(page, 'el gato')

      await page.getByRole('button', { name: 'Delete "el gato"' }).click()

      await expect(page.getByText('No flash cards yet.')).toBeVisible()
    })
  })

  test.describe('Navigation', () => {
    test('shows the not found page for an unknown address', async ({
      page,
    }) => {
      await page.goto('/no/such/page')

      await expect(
        page.getByRole('heading', { name: 'Page not found' }),
      ).toBeVisible()
      await page.getByRole('link', { name: 'Go to flash cards' }).click()
      await expect(
        page.getByRole('heading', { name: 'Add flash card' }),
      ).toBeVisible()
    })
  })
})
