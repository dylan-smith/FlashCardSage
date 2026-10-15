import { test, expect, type Page } from '@playwright/test'

// The token the signed-in smoke test uses: the service token in production, and a test sign-in elsewhere, where
// test sign-in is turned on.
const authToken = process.env.SMOKE_AUTH_TOKEN ?? 'test:Smoke User'

// Saves a session the way the frontend does after signing in (see src/auth/session.ts), before the page loads.
async function signIn(page: Page) {
  await page.addInitScript((token) => {
    localStorage.setItem(
      'flashcardsage.session',
      JSON.stringify({ token, name: 'Smoke Test', provider: 'service' }),
    )
  }, authToken)
}

// Waits for the list of cards to load. A serverless database resuming from auto-pause (as a preview's often is)
// can take well over the usual 5 seconds to answer.
async function waitForList(page: Page) {
  await expect(page.getByLabel('Loading', { exact: true })).toBeHidden({
    timeout: 90_000,
  })
}

test('smoke: app loads and asks the user to sign in', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'FlashCardSage' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Sign in', exact: true }),
  ).toBeVisible()
})

test('smoke: can add, edit and delete a flash card', async ({ page }) => {
  // Room for both waits for the list, on top of the usual steps.
  test.setTimeout(4 * 60_000)
  const title = `Smoke Test ${Date.now()}`
  const renamed = `${title} renamed`
  await signIn(page)

  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'FlashCardSage' }),
  ).toBeVisible()
  await waitForList(page)

  await page.getByLabel('Spanish').fill(title)
  await page.getByLabel('English').fill(`${title} in English`)
  await page.getByRole('button', { name: 'Add flash card' }).click()
  await expect(page.getByText(title, { exact: true })).toBeVisible()

  try {
    // Reloading checks the card was saved, and that the host serves the app again.
    await page.reload()
    await waitForList(page)
    await expect(page.getByText(title, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: `Edit "${title}"` }).click()
    await page.getByRole('listitem').getByLabel('Spanish').fill(renamed)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText(renamed, { exact: true })).toBeVisible()
  } finally {
    // Best-effort cleanup so we don't leave data behind if the test fails mid-run. Only this run's card is
    // deleted, by whichever name it has by now, so a card an earlier run left behind can't be deleted instead.
    for (const name of [renamed, title]) {
      await page
        .getByRole('button', { name: `Delete "${name}"`, exact: true })
        .click({ timeout: 5_000 })
        .then(() =>
          page
            .getByRole('dialog', { name: `Delete "${name}"?`, exact: true })
            .getByRole('button', { name: 'Delete' })
            .click({ timeout: 5_000 }),
        )
        .catch(() => {})
    }
  }

  await expect(page.getByText(renamed, { exact: true })).toBeHidden()
  await expect(page.getByText(title, { exact: true })).toBeHidden()
})
