import { test, expect } from './fixtures'

// The backend started by playwright.config.ts.
const flashCardsApiUrl = 'http://localhost:5269/api/flashcards'

test.describe('Scores', () => {
  test.beforeEach(async ({ request }) => {
    // Start from no cards, so the total is just the ones each test adds.
    const response = await request.get(flashCardsApiUrl)
    expect(response.ok()).toBe(true)
    for (const { id } of (await response.json()) as { id: number }[]) {
      expect((await request.delete(`${flashCardsApiUrl}/${id}`)).ok()).toBe(
        true,
      )
    }
  })

  test('scores each card from its practice and lists the lowest first', async ({
    page,
    request,
  }) => {
    // The dog is got right twice in a row, and the cat's run is broken by I was close.
    const answers = [
      { spanish: 'el perro', english: 'the dog', outcomes: ['GotIt', 'GotIt'] },
      {
        spanish: 'el gato',
        english: 'the cat',
        outcomes: ['GotIt', 'WasClose'],
      },
    ]
    for (const { spanish, english, outcomes } of answers) {
      const response = await request.post(flashCardsApiUrl, {
        data: { spanish, english },
      })
      expect(response.ok()).toBe(true)
      const { id } = (await response.json()) as { id: number }
      for (const outcome of outcomes) {
        expect(
          (
            await request.post(`${flashCardsApiUrl}/${id}/practice-results`, {
              data: { outcome },
            })
          ).ok(),
        ).toBe(true)
      }
    }

    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Mode' })
      .getByRole('link', { name: 'Scores' })
      .click()

    await expect(page.getByText('Total score 80 / 200 (40%)')).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Card scores' }).getByRole('listitem'),
    ).toHaveText([/el gato.*0 \/ 100/, /el perro.*80 \/ 100/])
  })

  test('points to adding cards when there are none', async ({ page }) => {
    await page.goto('/scores')
    await expect(
      page.getByText('There are no flash cards to score yet.'),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Add flash cards' }).click()

    await expect(
      page.getByRole('heading', { name: 'Add flash card' }),
    ).toBeVisible()
  })
})
