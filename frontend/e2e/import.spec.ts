import { cardData, onePixelPng, test, expect } from './fixtures'

// The backend started by playwright.config.ts, which adds the built-in decks when it starts.
const apiUrl = 'http://localhost:5269/api'

test.describe('Import cards', () => {
  test.beforeEach(async ({ request }) => {
    // Start from one card that's on a built-in deck, with no decks or tags, deleted through the API like
    // decks.spec.ts does.
    for (const resource of ['decks', 'flashcards', 'tags']) {
      const response = await request.get(`${apiUrl}/${resource}`)
      expect(response.ok()).toBe(true)
      for (const { id } of (await response.json()) as { id: number }[]) {
        expect((await request.delete(`${apiUrl}/${resource}/${id}`)).ok()).toBe(
          true,
        )
      }
    }
    expect(
      (
        await request.post(`${apiUrl}/flashcards`, {
          data: cardData('lunes', 'Monday'),
        })
      ).ok(),
    ).toBe(true)
  })

  test('adds a built-in deck, leaving out the card the user has', async ({
    page,
  }) => {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Manage cards' })
      .getByRole('link', { name: 'Import cards' })
      .click()

    await expect(
      page
        .getByRole('listitem')
        .filter({
          has: page.getByRole('button', {
            name: 'Days of the week',
            exact: true,
          }),
        })
        .getByText('7 cards', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Days of the week', exact: true })
      .click()
    await expect(
      page
        .getByRole('list', { name: 'Cards in "Days of the week"' })
        .getByRole('listitem'),
    ).toHaveCount(7)

    await page
      .getByRole('button', { name: 'Add deck "Days of the week"' })
      .click()

    await expect(
      page.getByText(
        'Added Days of the week with 6 cards. 1 card was left out because you already have it.',
      ),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Open deck' }).click()

    await expect(
      page.getByRole('tab', { name: 'In this deck (6)' }),
    ).toBeVisible()
    await expect(page.getByText('martes', { exact: true })).toBeVisible()

    // The deck's tag came with it, and adding the deck again finds nothing new.
    await page
      .getByRole('navigation', { name: 'Manage cards' })
      .getByRole('link', { name: 'Tags' })
      .click()
    await expect(page.getByRole('link', { name: 'Days' })).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Manage cards' })
      .getByRole('link', { name: 'Import cards' })
      .click()
    await page
      .getByRole('button', { name: 'Add deck "Days of the week"' })
      .click()
    await expect(page.getByRole('alert')).toHaveText(
      'You already have all of these cards.',
    )
  })

  test("adds a built-in deck's cards one at a time, making the deck for the first", async ({
    page,
  }) => {
    await page.goto('/import')
    await page
      .getByRole('button', { name: 'Days of the week', exact: true })
      .click()
    const cards = page.getByRole('list', {
      name: 'Cards in "Days of the week"',
    })
    // The user already has lunes.
    await expect(
      cards.getByRole('button', { name: 'Added "lunes"' }),
    ).toBeDisabled()

    await cards.getByRole('button', { name: 'Add "martes"' }).click()
    await expect(
      page.getByText('Added "martes" to a new deck, Days of the week.'),
    ).toBeVisible()
    await expect(
      cards.getByRole('button', { name: 'Added "martes"' }),
    ).toBeDisabled()

    await cards.getByRole('button', { name: 'Add "miércoles"' }).click()
    await expect(
      page.getByText('Added "miércoles" to Days of the week.'),
    ).toBeVisible()

    // The added cards still say so when the page is opened again.
    await page.reload()
    await page
      .getByRole('button', { name: 'Days of the week', exact: true })
      .click()
    for (const spanish of ['lunes', 'martes', 'miércoles']) {
      await expect(
        cards.getByRole('button', { name: `Added "${spanish}"` }),
      ).toBeDisabled()
    }
    await expect(
      cards.getByRole('button', { name: 'Add "jueves"' }),
    ).toBeEnabled()

    await page.goto('/decks')
    // Both cards went on the one deck.
    await expect(page.getByRole('link', { name: 'Decks 1' })).toBeVisible()
    await page
      .getByRole('link', { name: 'Days of the week', exact: true })
      .click()
    await expect(
      page.getByRole('tab', { name: 'In this deck (2)' }),
    ).toBeVisible()
  })

  test('adds the cards scanned from a document, one and then the rest, after changing and removing some', async ({
    page,
  }) => {
    // The E2E backend has no Foundry endpoint or key, so stand in for the scan with as many cards as one makes, one of
    // them a card the user already has.
    await page.route('**/api/document-scans', async (route) => {
      await route.fulfill({
        json: {
          candidates: [
            { spanish: 'lunes', english: 'Monday' },
            ...Array.from({ length: 99 }, (_, index) => ({
              spanish: `palabra ${index + 1}`,
              english: `word ${index + 1}`,
            })),
          ],
          truncated: false,
        },
      })
    })
    await page.goto('/import')

    // Its own tab, which the URL keeps.
    await page.getByRole('tab', { name: 'From a document' }).click()
    await expect(page).toHaveURL(/\/import\?from=document$/)
    await expect(
      page.getByRole('tabpanel', { name: 'Built-in decks' }),
    ).toBeHidden()
    await page.getByLabel('Choose a document').setInputFiles({
      name: 'cuento.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Había una vez una palabra.'),
    })

    const cards = page.getByRole('list', { name: 'Cards from the document' })
    await expect(cards.getByRole('listitem')).toHaveCount(100)
    // The document's name is over its cards.
    await expect(
      page.getByRole('heading', { name: '100 cards from “cuento.txt”' }),
    ).toBeVisible()
    // Said in a toast when the scan is done.
    await expect(
      page.getByText(
        "This document has more words and phrases than one scan finds, so here are the first 100. Once you've added them, scan it again for more.",
      ),
    ).toBeVisible()

    // A look at the built-in decks keeps the cards.
    await page.getByRole('tab', { name: 'Built-in decks' }).click()
    await expect(cards).toBeHidden()
    await page.getByRole('tab', { name: 'From a document' }).click()
    await expect(cards.getByRole('listitem')).toHaveCount(100)

    await page.getByRole('button', { name: 'Remove "palabra 2"' }).click()
    // Changed with the same form as the cards page: another English word and a tag.
    await page.getByRole('button', { name: 'Edit "palabra 1"' }).click()
    await page.getByLabel('Spanish', { exact: true }).fill('la palabra')
    await page.getByLabel('English', { exact: true }).fill('the word')
    await page.getByRole('button', { name: 'Add English translation' }).click()
    await page.getByLabel('English 2', { exact: true }).fill('the term')
    const tagsInput = page.getByRole('combobox', { name: 'Tags' })
    await tagsInput.fill('Cuento')
    await tagsInput.press('Enter')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(cards.getByRole('listitem')).toHaveCount(99)
    await expect(
      page.getByRole('heading', { name: '99 cards from “cuento.txt”' }),
    ).toBeVisible()
    await expect(cards.getByText('the word / the term')).toBeVisible()

    // One card added on its own leaves the list, and the rest are added all at once.
    await page.getByRole('button', { name: 'Add "palabra 3"' }).click()
    await expect(page.getByText('Added “palabra 3”.')).toBeVisible()
    await expect(cards.getByRole('listitem')).toHaveCount(98)
    await page.getByRole('button', { name: 'Add all 98 cards' }).last().click()

    await expect(
      page.getByText(
        'Added 98 cards from “cuento.txt”. 1 card was left out because you already have it. The document may have more words and phrases, so scan it again to find them.',
      ),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Scan it again' }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'View cards' }).click()
    await expect(page.getByText('la palabra', { exact: true })).toBeVisible()
    await expect(
      page.getByText('the word / the term', { exact: true }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'la palabra' })
        .getByText('Cuento', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('palabra 2', { exact: true })).toHaveCount(0)
    await expect(page.getByText('palabra 3', { exact: true })).toBeVisible()
  })

  test('searches the cards scanned from a document and adds just the ones that match', async ({
    page,
  }) => {
    // The E2E backend has no Foundry endpoint or key, so stand in for the scan.
    await page.route('**/api/document-scans', async (route) => {
      await route.fulfill({
        json: {
          candidates: [
            { spanish: 'canción', english: 'song' },
            { spanish: 'cantar', english: 'to sing' },
            { spanish: 'bailar', english: 'to dance' },
          ],
          truncated: false,
        },
      })
    })
    await page.goto('/import?from=document')
    await page.getByLabel('Choose a document').setInputFiles({
      name: 'cuento.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Cantar y bailar.'),
    })
    const cards = page.getByRole('list', { name: 'Cards from the document' })
    await expect(cards.getByRole('listitem')).toHaveCount(3)

    // Without its accent, as the other card lists' search finds it.
    const search = page.getByRole('searchbox', { name: 'Search' })
    await search.fill('cancion')
    await expect(cards.getByRole('listitem')).toHaveCount(1)
    await search.fill('xyz')
    await expect(page.getByText('No cards match.')).toBeVisible()

    // Add all adds just the cards that match, and the rest stay to look over.
    await search.fill('can')
    await expect(cards.getByRole('listitem')).toHaveCount(2)
    await page.getByRole('button', { name: 'Add all 2 cards' }).last().click()
    await expect(
      page.getByText('Added 2 cards from “cuento.txt”.'),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '1 card from “cuento.txt”' }),
    ).toBeVisible()
    await search.fill('')
    await expect(cards.getByRole('listitem')).toHaveCount(1)
    await expect(cards.getByText('bailar', { exact: true })).toBeVisible()

    // The last one finishes the scan, counting the ones added before.
    await page.getByRole('button', { name: 'Add "bailar"' }).click()
    await expect(
      page.getByText('Added 3 cards from “cuento.txt”.'),
    ).toBeVisible()
  })

  test('puts the picture made for a scanned card on it once it’s added', async ({
    page,
  }) => {
    // The E2E backend has no Foundry endpoint, key or image generator, so stand in for the scan and the picture.
    await page.route('**/api/document-scans', async (route) => {
      await route.fulfill({
        json: {
          candidates: [
            { spanish: 'nadar', english: 'to swim' },
            { spanish: 'correr', english: 'to run' },
          ],
          truncated: false,
        },
      })
    })
    await page.route('**/api/flashcards/images/generate', async (route) => {
      await route.fulfill({ json: onePixelPng })
    })
    await page.goto('/import?from=document')
    await page.getByLabel('Choose a document').setInputFiles({
      name: 'cuento.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Nadar y correr.'),
    })

    await page.getByRole('button', { name: 'Edit "nadar"' }).click()
    await page.getByRole('button', { name: 'Generate picture' }).click()
    await expect(
      page.getByRole('img', { name: 'Generated picture' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Save' }).click()
    // Kept with the card in the browser until it's added.
    await expect(
      page.getByRole('img', { name: 'Picture for "nadar"' }),
    ).toHaveAttribute('src', /^data:image\/png;base64,/)

    await page.getByRole('button', { name: 'Add all 2 cards' }).last().click()
    await expect(
      page.getByText('Added 2 cards from “cuento.txt”.'),
    ).toBeVisible()
    await page.getByRole('link', { name: 'View cards' }).click()
    await expect(
      page.getByRole('img', { name: 'Picture for "nadar"' }),
    ).toHaveAttribute(
      'src',
      /^http:\/\/localhost:5269\/card-images\/[0-9a-f]{32}\.png$/,
    )
    await expect(
      page.getByRole('img', { name: 'Picture for "correr"' }),
    ).toHaveCount(0)
  })

  test('says why a document can’t be scanned', async ({ page }) => {
    await page.goto('/import?from=document')

    // The E2E backend has no Foundry endpoint or key, so scanning isn't available there.
    await page.getByLabel('Choose a document').setInputFiles({
      name: 'cuento.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Había una vez.'),
    })

    await expect(page.getByRole('alert')).toHaveText(
      "Scanning documents isn't available right now.",
    )
  })
})
