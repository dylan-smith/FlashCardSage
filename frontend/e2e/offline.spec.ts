import { test, expect } from './fixtures'

test.describe('Offline', () => {
  // Practicing itself still needs the API for now: once the practice page works from the cards kept on the device,
  // this also expects Reveal after the offline reload.
  test('the app opens again with no connection once it has been opened', async ({
    page,
    context,
  }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'FlashCardSage' }),
    ).toBeVisible()
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
  })
})
