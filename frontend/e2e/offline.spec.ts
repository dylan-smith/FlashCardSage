import { test, expect } from './fixtures'

test.describe('Offline', () => {
  test.beforeEach(async ({ api }) => {
    // Start from just these cards, so the one shown is always one of them.
    await api.reset('flashcards')
    await api.createCard('el gato', 'the cat')
    await api.createCard('el perro', 'the dog')
  })

  test('the app opens again with no connection once it has been opened, and practice works', async ({
    page,
    context,
  }) => {
    await page.goto('/practice')
    // Practice has kept the cards on the device once Reveal shows.
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible()
    // The service worker has kept the app once it's active.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })

    await context.setOffline(true)
    await page.reload()

    await expect(
      page.getByRole('heading', { name: 'FlashCardSage' }),
    ).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Mode' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible()
  })

  test('keeps the answers given offline and saves them once back online', async ({
    page,
    context,
    api,
  }) => {
    await page.goto('/practice')
    const reveal = page.getByRole('button', { name: 'Reveal' })
    await expect(reveal).toBeVisible()

    await context.setOffline(true)
    await reveal.click()
    await page.getByRole('button', { name: 'Got it!' }).click()

    // The next card, and a note that the answer is waiting.
    await expect(reveal).toBeVisible()
    await expect(page.getByText(/^Session score/)).toHaveText(
      'Session score +50',
    )
    await expect(page.getByRole('status')).toHaveText(
      "Offline – 1 answer will be saved when you're back online.",
    )

    await context.setOffline(false)
    await reveal.click()
    await page.getByRole('button', { name: 'I was close' }).click()

    await expect(page.getByRole('status')).toHaveText('')
    // Both answers reach the API.
    await expect
      .poll(async () =>
        (await api.scores()).cards.reduce(
          (total, card) => total + card.gotIt + card.wasClose + card.failed,
          0,
        ),
      )
      .toBe(2)
  })

  test('Sentences mode says it needs a connection', async ({
    page,
    context,
    api,
  }) => {
    // Sentences need at least 3 cards.
    await api.createCard('la casa', 'the house')
    await page.addInitScript(() => {
      localStorage.setItem('flashcardsage.practiceMode', '"sentences"')
    })
    await page.goto('/practice')
    // The E2E backend has no Foundry, so once the cards are loaded there are no sentences.
    await expect(page.getByText("Sentences aren't available.")).toBeVisible()

    await context.setOffline(true)

    await expect(
      page.getByText(
        "Sentences need a connection, since they're written for you as you go. Switch to Cards to practice offline.",
      ),
    ).toBeVisible()
  })
})
