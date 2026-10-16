import { test, expect, cardData } from './fixtures'

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
        data: cardData(spanish, english),
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

  test('scores and totals just the cards in the deck picked', async ({
    page,
    request,
  }) => {
    const ids: number[] = []
    for (const [spanish, english] of [
      ['el perro', 'the dog'],
      ['la casa', 'the house'],
    ]) {
      const response = await request.post(flashCardsApiUrl, {
        data: cardData(spanish, english),
      })
      expect(response.ok()).toBe(true)
      ids.push(((await response.json()) as { id: number }).id)
    }
    expect(
      (
        await request.post(`${flashCardsApiUrl}/${ids[0]}/practice-results`, {
          data: { outcome: 'GotIt' },
        })
      ).ok(),
    ).toBe(true)
    // Decks outlive the cards deleted before each test, so this one's name is new each run.
    const deckName = `Pets ${Date.now()}`
    expect(
      (
        await request.post('http://localhost:5269/api/decks', {
          data: { name: deckName, flashCardIds: [ids[0]] },
        })
      ).ok(),
    ).toBe(true)

    await page.goto('/scores')
    await expect(page.getByText('Total score 50 / 200 (25%)')).toBeVisible()
    await page.getByRole('combobox', { name: 'Cards' }).click()
    await page.getByRole('option', { name: `Deck: ${deckName}` }).click()

    await expect(page.getByText('Total score 50 / 100 (50%)')).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Card scores' }).getByRole('listitem'),
    ).toHaveText([/el perro.*50 \/ 100/])
    await expect(page).toHaveURL(/\/scores\?deck=\d+$/)
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
