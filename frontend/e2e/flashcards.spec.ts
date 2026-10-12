import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

// The backend started by playwright.config.ts.
const flashCardsApiUrl = 'http://localhost:5269/api/flashcards'

// Adds a flash card from the form and waits for it to appear in the list.
async function createFlashCard(page: Page, spanish: string, english: string) {
  await page.getByLabel('Spanish').fill(spanish)
  await page.getByLabel('English').fill(english)
  await page.getByRole('button', { name: 'Add flash card' }).click()
  await expect(
    page.getByRole('listitem').filter({ hasText: spanish }),
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
    test('adds a new card with its translation', async ({ page }) => {
      await createFlashCard(page, 'el gato', 'the cat')

      await expect(page.getByText('the cat', { exact: true })).toBeVisible()
    })

    test('trims whitespace from both sides', async ({ page }) => {
      await page.getByLabel('Spanish').fill('  el perro  ')
      await page.getByLabel('English').fill('  the dog  ')
      await page.getByRole('button', { name: 'Add flash card' }).click()

      await expect(page.getByText('el perro', { exact: true })).toBeVisible()
      await expect(page.getByText('the dog', { exact: true })).toBeVisible()
    })

    test('clears the inputs after adding a card', async ({ page }) => {
      await createFlashCard(page, 'la casa', 'the house')
      await expect(page.getByLabel('Spanish')).toHaveValue('')
      await expect(page.getByLabel('English')).toHaveValue('')
    })

    test('lists cards in the order they were added', async ({ page }) => {
      await createFlashCard(page, 'uno', 'one')
      await createFlashCard(page, 'dos', 'two')
      await createFlashCard(page, 'tres', 'three')

      const items = page.getByRole('listitem')
      await expect(items).toHaveCount(3)
      await expect(items.nth(0)).toContainText('uno')
      await expect(items.nth(1)).toContainText('dos')
      await expect(items.nth(2)).toContainText('tres')
    })

    test('fills in the translation, which the user can type over', async ({
      page,
    }) => {
      // The E2E backend has no translator key, so stand in for Azure AI Translator.
      await page.route('**/api/translations', async (route) => {
        const { text } = route.request().postDataJSON() as { text: string }
        await route.fulfill({
          json: { translation: text === 'el gato' ? 'the cat' : '?' },
        })
      })

      await page.getByLabel('Spanish').fill('el gato')

      const english = page.getByLabel('English')
      await expect(english).toHaveValue('the cat')
      await expect(
        page.getByText('Auto-translated: edit to change'),
      ).toBeVisible()
      await english.fill('the kitty')
      await page.getByRole('button', { name: 'Add flash card' }).click()

      await expect(page.getByText('the kitty', { exact: true })).toBeVisible()
    })

    test("lets the user pick another of a word's meanings", async ({
      page,
    }) => {
      await page.route('**/api/translations', async (route) => {
        await route.fulfill({
          json: {
            translation: 'silla',
            alternatives: ['cátedra', 'presidente'],
          },
        })
      })

      await page.getByLabel('English').fill('chair')
      await expect(page.getByLabel('Spanish')).toHaveValue('silla')
      await page.getByRole('button', { name: 'presidente' }).click()
      await page.getByRole('button', { name: 'Add flash card' }).click()

      await expect(page.getByText('presidente', { exact: true })).toBeVisible()
      await expect(page.getByText('chair', { exact: true })).toBeVisible()
    })

    test('keeps the cards after a reload', async ({ page }) => {
      await createFlashCard(page, 'el libro', 'the book')

      await page.reload()

      await expect(page.getByText('el libro', { exact: true })).toBeVisible()
      await expect(page.getByText('the book', { exact: true })).toBeVisible()
    })
  })

  test.describe('Edit flash card', () => {
    test('changes both sides', async ({ page }) => {
      await createFlashCard(page, 'el gato', 'the cat')

      await page.getByRole('button', { name: 'Edit "el gato"' }).click()
      const spanish = page.getByRole('listitem').getByLabel('Spanish')
      const english = page.getByRole('listitem').getByLabel('English')
      await expect(spanish).toHaveValue('el gato')
      await expect(english).toHaveValue('the cat')
      await spanish.fill('  el perro  ')
      await english.fill('  the dog  ')
      await page.getByRole('button', { name: 'Save' }).click()

      await expect(page.getByText('el perro', { exact: true })).toBeVisible()
      await expect(page.getByText('the dog', { exact: true })).toBeVisible()
      await expect(page.getByText('el gato', { exact: true })).toBeHidden()
      await expect(page.getByRole('button', { name: 'Save' })).toBeHidden()
      await page.reload()
      await expect(page.getByText('el perro', { exact: true })).toBeVisible()
      await expect(page.getByText('the dog', { exact: true })).toBeVisible()
    })

    test('saves with Enter', async ({ page }) => {
      await createFlashCard(page, 'el gato', 'the cat')

      await page.getByRole('button', { name: 'Edit "el gato"' }).click()
      const input = page.getByRole('listitem').getByLabel('English')
      await input.fill('the tomcat')
      await input.press('Enter')

      await expect(page.getByText('the tomcat', { exact: true })).toBeVisible()
    })

    test('can be cancelled', async ({ page }) => {
      await createFlashCard(page, 'el gato', 'the cat')

      await page.getByRole('button', { name: 'Edit "el gato"' }).click()
      await page.getByRole('listitem').getByLabel('Spanish').fill('changed')
      await page.getByRole('button', { name: 'Cancel' }).click()

      await expect(page.getByText('el gato', { exact: true })).toBeVisible()
      await expect(page.getByText('changed', { exact: true })).toBeHidden()
    })

    test('refuses a blank translation', async ({ page }) => {
      await createFlashCard(page, 'el gato', 'the cat')

      await page.getByRole('button', { name: 'Edit "el gato"' }).click()
      await page.getByRole('listitem').getByLabel('English').fill('   ')
      await page.getByRole('button', { name: 'Save' }).click()

      await expect(page.getByRole('alert')).toHaveText('English is required.')
      await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
    })
  })

  test.describe('Delete flash card', () => {
    test('removes the card', async ({ page }) => {
      await createFlashCard(page, 'el gato', 'the cat')
      await createFlashCard(page, 'el perro', 'the dog')

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
      await createFlashCard(page, 'el gato', 'the cat')

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
