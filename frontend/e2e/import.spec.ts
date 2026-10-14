import { cardData, test, expect } from './fixtures'

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

    await page.getByLabel('Choose a document').setInputFiles({
      name: 'cuento.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Había una vez una palabra.'),
    })

    const cards = page.getByRole('list', { name: 'Cards from the document' })
    await expect(cards.getByRole('listitem')).toHaveCount(100)
    await expect(
      page.getByText(
        "This document has more words and phrases than one scan finds, so here are the first 100. Once you've added them, scan it again for more.",
      ),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Remove "palabra 2"' }).click()
    await page.getByRole('button', { name: 'Edit "palabra 1"' }).click()
    await page.getByLabel('Spanish').fill('la palabra')
    await page.getByLabel('English').fill('the word')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(cards.getByRole('listitem')).toHaveCount(99)

    // One card added on its own leaves the list, and the rest are added all at once.
    await page.getByRole('button', { name: 'Add "palabra 3"' }).click()
    await expect(page.getByText('Added “palabra 3”.')).toBeVisible()
    await expect(cards.getByRole('listitem')).toHaveCount(98)
    await page.getByRole('button', { name: 'Add all 98 cards' }).click()

    await expect(
      page.getByText(
        'Added 98 cards. 1 card was left out because you already have it. The document may have more words and phrases, so scan it again to find them.',
      ),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Scan it again' }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'View cards' }).click()
    await expect(page.getByText('la palabra', { exact: true })).toBeVisible()
    await expect(page.getByText('the word', { exact: true })).toBeVisible()
    await expect(page.getByText('palabra 2', { exact: true })).toHaveCount(0)
    await expect(page.getByText('palabra 3', { exact: true })).toBeVisible()
  })

  test('says why a document can’t be scanned', async ({ page }) => {
    await page.goto('/import')

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
