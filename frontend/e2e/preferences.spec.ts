import AxeBuilder from '@axe-core/playwright'
import {
  test,
  expect,
  cardData,
  onePixelPng,
  sessionStorageEntry,
} from './fixtures'

// The backend started by playwright.config.ts.
const apiUrl = 'http://localhost:5269/api'

// A user of their own, since preferences apply to everything the user does and the other specs expect the defaults.
const name = `Preferences Tester ${Date.now()}`
const token = `test:${name}`

test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:4173',
        localStorage: [sessionStorageEntry(name)],
      },
    ],
  },
})

test('the user can turn off pictures, suggestions and translation', async ({
  page,
  playwright,
}) => {
  const request = await playwright.request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  })
  const created = await request.post(`${apiUrl}/flashcards`, {
    data: cardData('el gato', 'the cat'),
  })
  expect(created.ok()).toBe(true)
  const { id } = (await created.json()) as { id: number }
  expect(
    (
      await request.put(`${apiUrl}/flashcards/${id}/image`, {
        data: onePixelPng,
      })
    ).ok(),
  ).toBe(true)
  await request.dispose()
  // The E2E backend has no Foundry endpoint, key or translator key, so stand in for the model and the translator.
  await page.route('**/api/card-suggestions*', async (route) => {
    await route.fulfill({ json: [{ spanish: 'el perro', english: 'the dog' }] })
  })
  let translations = 0
  await page.route('**/api/translations', async (route) => {
    translations++
    await route.fulfill({ json: { translation: 'the house' } })
  })

  await page.goto('/')
  await expect(
    page.getByRole('img', { name: 'Picture for "el gato"' }),
  ).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'Suggested cards' }),
  ).toBeVisible()

  await page.getByRole('link', { name: 'Preferences' }).click()
  await expect(
    page.getByRole('heading', { name: 'Preferences', level: 2 }),
  ).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  for (const option of [
    'Show pictures',
    'Suggest cards',
    'Translate automatically',
  ]) {
    const saved = page.waitForResponse(
      (response) =>
        response.url() === `${apiUrl}/preferences` &&
        response.request().method() === 'PUT',
    )
    await page.getByRole('switch', { name: option }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page.getByRole('switch', { name: option })).not.toBeChecked()
  }

  // The preferences are kept by the API, so they last across a reload.
  await page.goto('/')
  await expect(page.getByText('el gato', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('img', { name: 'Picture for "el gato"' }),
  ).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Generate picture' }),
  ).toBeHidden()
  await expect(
    page.getByRole('heading', { name: 'Suggested cards' }),
  ).toBeHidden()

  await page.getByRole('link', { name: 'Practice' }).click()
  await page.getByRole('button', { name: 'Reveal' }).click()
  await expect(page.getByText('the cat', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: /^Picture for/ })).toBeHidden()

  await page.getByRole('link', { name: 'Manage cards' }).click()
  // The user types both sides. (The unit tests check that nothing is translated once they stop typing.)
  await page.getByLabel('Spanish').fill('la casa')
  await page.getByLabel('English').fill('the home')
  await page.getByRole('button', { name: 'Add flash card' }).click()
  await expect(page.getByText('the home', { exact: true })).toBeVisible()
  expect(translations).toBe(0)
})
