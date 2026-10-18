import {
  test,
  expect,
  addCard,
  apiOrigin,
  confirmDelete,
  onePixelPng,
} from './fixtures'

test.describe('Flash card management', () => {
  test.beforeEach(async ({ page, api }) => {
    // Delete leftover cards, including ones other spec files created.
    await api.reset('flashcards')

    // Wait for the initial load to finish, so its response can't overwrite a list the test changes.
    await page.goto('/')
    await expect(page.getByText('No flash cards yet.')).toBeVisible()
  })

  test.describe('Add flash card', () => {
    test('adds a new card with its translation', async ({ page }) => {
      await addCard(page, 'el gato', 'the cat')

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
      await addCard(page, 'la casa', 'the house')
      await expect(page.getByLabel('Spanish')).toHaveValue('')
      await expect(page.getByLabel('English')).toHaveValue('')
    })

    test('lists cards in the order they were added', async ({ page }) => {
      await addCard(page, 'uno', 'one')
      await addCard(page, 'dos', 'two')
      await addCard(page, 'tres', 'three')

      const items = page.getByRole('listitem')
      await expect(items).toHaveCount(3)
      await expect(items.nth(0)).toContainText('uno')
      await expect(items.nth(1)).toContainText('dos')
      await expect(items.nth(2)).toContainText('tres')
    })

    test('refuses a second card for the same Spanish or English', async ({
      page,
    }) => {
      await addCard(page, 'el gato', 'the cat')
      const add = page.getByRole('button', { name: 'Add flash card' })

      await page.getByLabel('Spanish').fill('El Gato')
      await page.getByLabel('English').fill('the tomcat')
      await add.click()
      await expect(page.getByRole('alert')).toHaveText(
        'You already have a flash card with the Spanish "el gato". Add this translation to that card instead.',
      )

      await page.getByLabel('Spanish').fill('el gatito')
      await page.getByLabel('English').fill('The Cat')
      await add.click()
      await expect(page.getByRole('alert')).toHaveText(
        'You already have a flash card with the English "the cat". Add this translation to that card instead.',
      )
      await expect(page.getByRole('listitem')).toHaveCount(1)
    })

    test('adds a card with more than one translation, and practices them as one card', async ({
      page,
    }) => {
      await page.getByLabel('Spanish').fill('solo')
      await page
        .getByRole('button', { name: 'Add Spanish translation' })
        .click()
      await page.getByLabel('Spanish 2', { exact: true }).fill('únicamente')
      await page.getByLabel('English').fill('only')
      await page.getByRole('button', { name: 'Add flash card' }).click()

      const item = page.getByRole('listitem').filter({ hasText: 'únicamente' })
      await expect(item).toContainText('solo / únicamente')
      await expect(item).toContainText('only')

      // Another card for "only" would leave practice unsure which Spanish it wants.
      await page.getByLabel('Spanish').fill('nada más')
      await page.getByLabel('English').fill('Only')
      await page.getByRole('button', { name: 'Add flash card' }).click()
      await expect(page.getByRole('alert')).toContainText(
        'You already have a flash card with the English "only".',
      )

      await page.goto('/practice')
      await page.getByRole('button', { name: 'Reveal' }).click()
      await expect(
        page.getByText('solo / únicamente', { exact: true }),
      ).toBeVisible()
      await expect(page.getByText('only', { exact: true })).toBeVisible()
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

    test('adds a suggested card', async ({ page }) => {
      // The E2E backend has no Foundry endpoint or key, so stand in for the model's suggestions. They load with the page.
      await page.route('**/api/card-suggestions', async (route) => {
        await route.fulfill({
          json: [
            { spanish: 'el perro', english: 'the dog' },
            { spanish: 'el pez', english: 'the fish' },
          ],
        })
      })
      await page.reload()
      const suggestions = page.getByRole('list', { name: 'Suggested cards' })
      await expect(suggestions.getByRole('listitem')).toHaveCount(2)

      await page.getByRole('button', { name: 'Add "el perro"' }).click()

      await expect(suggestions.getByRole('listitem')).toHaveCount(1)
      await expect(
        page.getByRole('button', { name: 'Edit "el perro"' }),
      ).toBeVisible()
      await page.reload()
      await expect(page.getByText('the dog', { exact: true })).toBeVisible()
    })

    test('suggests cards related to a card just added', async ({ page }) => {
      // As above, stand in for the model, answering with cards related to the one added when it's asked for.
      await page.route('**/api/card-suggestions*', async (route) => {
        const related = new URL(route.request().url()).searchParams.has(
          'relatedTo',
        )
        await route.fulfill({
          json: related
            ? [{ spanish: 'el collar', english: 'the collar' }]
            : [{ spanish: 'el pez', english: 'the fish' }],
        })
      })
      await page.reload()
      const suggestions = page.getByRole('list', { name: 'Suggested cards' })
      await expect(suggestions).toContainText('el pez')

      await addCard(page, 'el perro', 'the dog')

      await expect(suggestions).toContainText('el collar')
      await expect(suggestions).not.toContainText('el pez')
      await expect(
        page.getByText('New words and phrases that go with “el perro”.'),
      ).toBeVisible()
    })

    test('keeps the cards after a reload', async ({ page }) => {
      await addCard(page, 'el libro', 'the book')

      await page.reload()

      await expect(page.getByText('el libro', { exact: true })).toBeVisible()
      await expect(page.getByText('the book', { exact: true })).toBeVisible()
    })
  })

  test.describe('Edit flash card', () => {
    test('changes both sides', async ({ page }) => {
      await addCard(page, 'el gato', 'the cat')

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
      await addCard(page, 'el gato', 'the cat')

      await page.getByRole('button', { name: 'Edit "el gato"' }).click()
      const input = page.getByRole('listitem').getByLabel('English')
      await input.fill('the tomcat')
      await input.press('Enter')

      await expect(page.getByText('the tomcat', { exact: true })).toBeVisible()
    })

    test('can be cancelled', async ({ page }) => {
      await addCard(page, 'el gato', 'the cat')

      await page.getByRole('button', { name: 'Edit "el gato"' }).click()
      await page.getByRole('listitem').getByLabel('Spanish').fill('changed')
      await page.getByRole('button', { name: 'Cancel' }).click()

      await expect(page.getByText('el gato', { exact: true })).toBeVisible()
      await expect(page.getByText('changed', { exact: true })).toBeHidden()
    })

    test('refuses a blank translation', async ({ page }) => {
      await addCard(page, 'el gato', 'the cat')

      await page.getByRole('button', { name: 'Edit "el gato"' }).click()
      await page.getByRole('listitem').getByLabel('English').fill('   ')
      await page.getByRole('button', { name: 'Save' }).click()

      await expect(page.getByRole('alert')).toHaveText('English is required.')
      await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
    })
  })

  test.describe('Delete flash card', () => {
    test('removes the card', async ({ page }) => {
      await addCard(page, 'el gato', 'the cat')
      await addCard(page, 'el perro', 'the dog')

      await page.getByRole('button', { name: 'Delete "el gato"' }).click()
      const dialog = page.getByRole('dialog', { name: 'Delete "el gato"?' })
      await expect(dialog).toContainText("This can't be undone.")
      await dialog.getByRole('button', { name: 'Delete' }).click()

      await expect(page.getByText('el gato', { exact: true })).toBeHidden()
      await expect(page.getByText('el perro', { exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByText('el gato', { exact: true })).toBeHidden()
      await expect(page.getByText('el perro', { exact: true })).toBeVisible()
    })

    test('shows the empty message once the last card is gone', async ({
      page,
    }) => {
      await addCard(page, 'el gato', 'the cat')

      await page.getByRole('button', { name: 'Delete "el gato"' }).click()
      await confirmDelete(page, 'Delete "el gato"?')

      await expect(page.getByText('No flash cards yet.')).toBeVisible()
    })

    test('keeps the card when the delete is cancelled', async ({ page }) => {
      await addCard(page, 'el gato', 'the cat')

      await page.getByRole('button', { name: 'Delete "el gato"' }).click()
      await page
        .getByRole('dialog', { name: 'Delete "el gato"?' })
        .getByRole('button', { name: 'Cancel' })
        .click()

      await expect(page.getByRole('dialog')).toBeHidden()
      await page.reload()
      await expect(page.getByText('el gato', { exact: true })).toBeVisible()
    })

    test('deletes the cards picked at once', async ({ page }) => {
      await addCard(page, 'el gato', 'the cat')
      await addCard(page, 'el perro', 'the dog')
      await addCard(page, 'la casa', 'the house')

      await page.getByRole('checkbox', { name: 'Pick "el gato"' }).check()
      await page.getByRole('checkbox', { name: 'Pick "el perro"' }).check()
      await page.getByRole('button', { name: 'Delete 2 cards…' }).click()
      await confirmDelete(page, 'Delete 2 cards?')

      await expect(page.getByRole('status')).toHaveText('Deleted 2 cards.')
      await page.reload()
      await expect(page.getByText('la casa', { exact: true })).toBeVisible()
      await expect(page.getByText('el gato', { exact: true })).toBeHidden()
      await expect(page.getByText('el perro', { exact: true })).toBeHidden()
    })
  })

  test.describe('Pictures', () => {
    // Where the E2E backend keeps the pictures it's given (see Images/LocalFileImageStore.cs).
    const pictureUrlPrefix = `${apiOrigin}/card-images/`

    test.beforeEach(async ({ page }) => {
      // The E2E backend has no image generator, so stand in for Azure OpenAI.
      await page.route('**/api/flashcards/images/generate', async (route) => {
        await route.fulfill({ json: onePixelPng })
      })
    })

    test('discards the picture when the user asks', async ({ page }) => {
      await page.getByLabel('Spanish').fill('nadar')
      await page.getByLabel('English').fill('to swim')
      await page.getByRole('button', { name: 'Generate picture' }).click()
      await expect(
        page.getByRole('img', { name: 'Generated picture' }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Discard' }).click()

      await page.getByRole('button', { name: 'Add flash card' }).click()

      const item = page.getByRole('listitem').filter({ hasText: 'nadar' })
      await expect(item).toBeVisible()
      await expect(item.getByRole('img')).toBeHidden()
      await expect(
        page.getByRole('img', { name: 'Generated picture' }),
      ).toBeHidden()
    })

    test("puts the picture on the card when it's saved", async ({
      page,
      request,
    }) => {
      await page.getByLabel('Spanish').fill('nadar')
      await page.getByLabel('English').fill('to swim')
      await page.getByRole('button', { name: 'Generate picture' }).click()
      await expect(
        page.getByRole('img', { name: 'Generated picture' }),
      ).toBeVisible()

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

    test("puts an uploaded picture on the card when it's saved", async ({
      page,
      request,
    }) => {
      await page.getByLabel('Spanish').fill('nadar')
      await page.getByLabel('English').fill('to swim')
      await page.getByLabel('Upload picture').setInputFiles({
        name: 'swim.png',
        mimeType: 'image/png',
        buffer: Buffer.from(onePixelPng.data, 'base64'),
      })
      await expect(
        page.getByRole('img', { name: 'Uploaded picture' }),
      ).toBeVisible()

      await page.getByRole('button', { name: 'Add flash card' }).click()

      const picture = page.getByRole('img', { name: 'Picture for "nadar"' })
      await expect(picture).toBeVisible()
      const src = await picture.getAttribute('src')
      expect(src).toMatch(new RegExp(`^${pictureUrlPrefix}[0-9a-f]{32}\\.png$`))
      const served = await request.get(src!, { headers: { Authorization: '' } })
      expect(Buffer.from(await served.body()).toString('base64')).toBe(
        onePixelPng.data,
      )
    })

    test('takes the picture off the card when the user removes it', async ({
      page,
      request,
      api,
    }) => {
      const { id } = await api.createCard('nadar', 'to swim')
      const { imageUrl } = await api.addPicture(id)
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
