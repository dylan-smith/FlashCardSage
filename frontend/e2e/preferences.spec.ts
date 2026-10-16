import { test, expect, apiUrl, expectNoA11yViolations } from './fixtures'

// A user of their own, since preferences apply to everything the user does and the other specs expect the defaults.
test.use({ userName: `Preferences Tester ${Date.now()}` })

test('the user can turn off pictures, suggestions and translation', async ({
  page,
  api,
}) => {
  const { id } = await api.createCard('el gato', 'the cat')
  await api.addPicture(id)
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
  // Move off the cog so its tooltip closes: the tooltip sits outside the landmarks, which axe flags.
  await page.mouse.move(0, 0)
  await expect(page.getByRole('tooltip')).toBeHidden()
  await expectNoA11yViolations(page)
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
