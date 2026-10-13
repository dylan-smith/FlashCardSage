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

    await expect(page.getByText('7 cards', { exact: true })).toBeVisible()
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
})
