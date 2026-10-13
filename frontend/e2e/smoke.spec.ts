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
  const title = `Smoke Test ${Date.now()}`
  const renamed = `${title} renamed`
  await signIn(page)

  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'FlashCardSage' }),
  ).toBeVisible()

  await page.getByLabel('Spanish').fill(title)
  await page.getByLabel('English').fill('a test card')
  await page.getByRole('button', { name: 'Add flash card' }).click()
  await expect(page.getByText(title, { exact: true })).toBeVisible()

  try {
    // Reloading checks the card was saved, and that the host serves the app again.
    await page.reload()
    await expect(page.getByText(title, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: `Edit "${title}"` }).click()
    await page.getByRole('listitem').getByLabel('Spanish').fill(renamed)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText(renamed, { exact: true })).toBeVisible()
  } finally {
    // Best-effort cleanup so we don't leave data behind if the test fails mid-run. It targets this run's card by name,
    // so a card an earlier failed run left behind isn't deleted instead.
    await page
      .getByRole('button', {
        name: new RegExp(`^Delete "(${title}|${renamed})"$`),
      })
      .click()
      .catch(() => {})
  }

  await expect(page.getByText(renamed, { exact: true })).toBeHidden()
  await expect(page.getByText(title, { exact: true })).toBeHidden()
})
