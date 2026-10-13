import { test, expect, onePixelPng } from './fixtures'

// The backend started by playwright.config.ts.
const flashCardsApiUrl = 'http://localhost:5269/api/flashcards'

const cards = [
  { spanish: 'el gato', english: 'the cat' },
  { spanish: 'el perro', english: 'the dog' },
]

test.describe('Practice', () => {
  test.beforeEach(async ({ request }) => {
    // Start from just these cards, so the one shown is always one of them.
    const response = await request.get(flashCardsApiUrl)
    expect(response.ok()).toBe(true)
    for (const { id } of (await response.json()) as { id: number }[]) {
      expect((await request.delete(`${flashCardsApiUrl}/${id}`)).ok()).toBe(
        true,
      )
    }
    for (const card of cards) {
      expect((await request.post(flashCardsApiUrl, { data: card })).ok()).toBe(
        true,
      )
    }
  })

  test('reveals a card, records the answer and moves on to the other card', async ({
    page,
  }) => {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Mode' })
      .getByRole('link', { name: 'Practice' })
      .click()
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible()

    // Either side of either card can come up, so find which one it is from the text shown. The card is on the
    // page by the time Reveal is.
    const candidates = cards.flatMap((card, index) => [
      {
        shownSide: card.spanish,
        hiddenSide: card.english,
        other: cards[1 - index],
      },
      {
        shownSide: card.english,
        hiddenSide: card.spanish,
        other: cards[1 - index],
      },
    ])
    const visible = await Promise.all(
      candidates.map(({ shownSide }) =>
        page.getByText(shownSide, { exact: true }).isVisible(),
      ),
    )
    const prompts = candidates.filter((_, index) => visible[index])
    expect(prompts).toHaveLength(1)
    const [{ shownSide, hiddenSide, other }] = prompts
    await expect(page.getByText(hiddenSide, { exact: true })).toBeHidden()

    await page.getByRole('button', { name: 'Reveal' }).click()

    await expect(page.getByText(hiddenSide, { exact: true })).toBeVisible()
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/practice-results') &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'I was close' }).click()

    expect((await saved).status()).toBe(200)
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible()
    await expect(
      page
        .getByText(other.spanish, { exact: true })
        .or(page.getByText(other.english, { exact: true })),
    ).toBeVisible()
    await expect(page.getByText(shownSide, { exact: true })).toBeHidden()
  })

  test('keeps a running score for the session', async ({ page }) => {
    await page.goto('/practice')
    const sessionScore = page.getByText(/^Session score/)
    await expect(sessionScore).toHaveText('Session score 0')

    // Both cards are new, so whichever comes up goes from 0 to 50.
    await page.getByRole('button', { name: 'Reveal' }).click()
    await page.getByRole('button', { name: 'Got it!' }).click()
    await expect(sessionScore).toHaveText('Session score +50')

    // Failed leaves the other card at 0, or drops the same one back to 0, whichever comes up next.
    await page.getByRole('button', { name: 'Reveal' }).click()
    await page.getByRole('button', { name: 'Failed :(' }).click()
    await expect(sessionScore).toHaveText(/^Session score (\+50|0)$/)
  })

  test("shows the card's picture once it's revealed", async ({
    page,
    request,
  }) => {
    // Only one card, with a picture, so it's the one that comes up.
    const response = await request.get(flashCardsApiUrl)
    const [first, ...rest] = (await response.json()) as { id: number }[]
    for (const { id } of rest) {
      await request.delete(`${flashCardsApiUrl}/${id}`)
    }
    const put = await request.put(`${flashCardsApiUrl}/${first.id}/image`, {
      data: onePixelPng,
    })
    expect(put.ok()).toBe(true)

    await page.goto('/practice')
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible()
    await expect(page.getByRole('img', { name: /^Picture for/ })).toBeHidden()

    await page.getByRole('button', { name: 'Reveal' }).click()

    await expect(page.getByRole('img', { name: /^Picture for/ })).toBeVisible()
  })

  test('points to adding cards when there are none', async ({
    page,
    request,
  }) => {
    const response = await request.get(flashCardsApiUrl)
    for (const { id } of (await response.json()) as { id: number }[]) {
      await request.delete(`${flashCardsApiUrl}/${id}`)
    }

    await page.goto('/practice')
    await expect(
      page.getByText('There are no flash cards to practice yet.'),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Add flash cards' }).click()

    await expect(
      page.getByRole('heading', { name: 'Add flash card' }),
    ).toBeVisible()
  })
})
