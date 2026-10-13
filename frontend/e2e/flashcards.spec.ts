import type { Page } from '@playwright/test'
import { test, expect, onePixelPng } from './fixtures'

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

    test('refuses a second card for the same Spanish or English', async ({
      page,
    }) => {
      await createFlashCard(page, 'el gato', 'the cat')
      const add = page.getByRole('button', { name: 'Add flash card' })

      await page.getByLabel('Spanish').fill('El Gato')
      await page.getByLabel('English').fill('the tomcat')
      await add.click()
      await expect(page.getByRole('alert')).toHaveText(
        'You already have a flash card with this Spanish.',
      )

      await page.getByLabel('Spanish').fill('el gatito')
      await page.getByLabel('English').fill('The Cat')
      await add.click()
      await expect(page.getByRole('alert')).toHaveText(
        'You already have a flash card with this English.',
      )
      await expect(page.getByRole('listitem')).toHaveCount(1)
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
      await english.fill('the cats')
      await page.getByRole('button', { name: 'Translate from Spanish' }).click()
      await expect(english).toHaveValue('the cat')
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

  test.describe('Pictures', () => {
    // Where the E2E backend keeps the pictures it's given (see Images/LocalFileImageStore.cs).
    const pictureUrlPrefix = 'http://localhost:5269/card-images/'

    test.beforeEach(async ({ page }) => {
      // The E2E backend has no image generator, so stand in for Azure OpenAI.
      await page.route('**/api/flashcards/images/generate', async (route) => {
        await route.fulfill({ json: onePixelPng })
      })
    })

    test('discards the picture unless the user adds it', async ({ page }) => {
      await page.getByLabel('Spanish').fill('nadar')
      await page.getByLabel('English').fill('to swim')
      await page.getByRole('button', { name: 'Generate picture' }).click()
      await expect(
        page.getByRole('img', { name: 'Generated picture' }),
      ).toBeVisible()
      await expect(
        page.getByRole('checkbox', { name: 'Add this picture to the card' }),
      ).not.toBeChecked()

      await page.getByRole('button', { name: 'Add flash card' }).click()

      const item = page.getByRole('listitem').filter({ hasText: 'nadar' })
      await expect(item).toBeVisible()
      await expect(item.getByRole('img')).toBeHidden()
      await expect(
        page.getByRole('img', { name: 'Generated picture' }),
      ).toBeHidden()
    })

    test('puts the picture on the card when the user adds it', async ({
      page,
      request,
    }) => {
      await page.getByLabel('Spanish').fill('nadar')
      await page.getByLabel('English').fill('to swim')
      await page.getByRole('button', { name: 'Generate picture' }).click()
      await page
        .getByRole('checkbox', { name: 'Add this picture to the card' })
        .check()

      await page.getByRole('button', { name: 'Add flash card' }).click()

      const picture = page.getByRole('img', { name: 'Picture for "nadar"' })
      await expect(picture).toBeVisible()
      const src = await picture.getAttribute('src')
      expect(src).toMatch(new RegExp(`^${pictureUrlPrefix}[0-9a-f]{32}\\.png$`))
      // The backend keeps the picture and serves it without the user's token, like blob storage would.
      const served = await request.get(src!, { headers: { Authorization: '' } })
      expect(served.status()).toBe(200)
      expect(served.headers()['content-type']).toBe('image/png')

      await page.reload()
      await expect(
        page.getByRole('img', { name: 'Picture for "nadar"' }),
      ).toHaveAttribute('src', src!)
    })

    test('takes the picture off the card when the user removes it', async ({
      page,
      request,
    }) => {
      const created = await request.post(flashCardsApiUrl, {
        data: { spanish: 'nadar', english: 'to swim' },
      })
      expect(created.ok()).toBe(true)
      const { id } = (await created.json()) as { id: number }
      const put = await request.put(`${flashCardsApiUrl}/${id}/image`, {
        data: onePixelPng,
      })
      expect(put.ok()).toBe(true)
      const { imageUrl } = (await put.json()) as { imageUrl: string }
      await page.reload()
      await expect(
        page.getByRole('img', { name: 'Picture for "nadar"' }),
      ).toBeVisible()

      await page.getByRole('button', { name: 'Edit "nadar"' }).click()
      await expect(
        page.getByRole('img', { name: "The card's picture" }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Remove picture' }).click()
      await expect(
        page.getByRole('img', { name: "The card's picture" }),
      ).toBeHidden()
      // The picture comes off after the card is saved, so wait for that before reloading, or the reload cuts it
      // short. (The Save button reads "Saving…" meanwhile, so it can't be waited for by name.)
      const removed = page.waitForResponse(
        (response) =>
          response.url().endsWith('/image') &&
          response.request().method() === 'DELETE',
      )
      await page.getByRole('button', { name: 'Save' }).click()
      expect((await removed).status()).toBe(200)

      await expect(
        page.getByRole('button', { name: 'Edit "nadar"' }),
      ).toBeVisible()
      await expect(
        page.getByRole('img', { name: 'Picture for "nadar"' }),
      ).toBeHidden()
      await page.reload()
      await expect(page.getByText('nadar', { exact: true })).toBeVisible()
      await expect(
        page.getByRole('img', { name: 'Picture for "nadar"' }),
      ).toBeHidden()
      // The picture itself is gone too.
      expect(
        (
          await request.get(imageUrl, { headers: { Authorization: '' } })
        ).status(),
      ).not.toBe(200)
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
