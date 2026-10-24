import {
  test,
  expect,
  addCard,
  apiUrl,
  expectNoA11yViolations,
} from './fixtures'

// A user of their own, who's new, since the guide is for a new user and the other specs' user has long had cards.
test.use({ userName: `Getting Started ${Date.now()}` })

test('a new user is shown how to get going, and can hide the guide once they have', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Getting started' }),
  ).toBeVisible()
  await expect(
    page.getByText("Welcome, Getting! Here's how to get going."),
  ).toBeVisible()
  await expect(page.getByRole('img', { name: 'To do' })).toHaveCount(3)
  await expect(page.getByLabel('Loading', { exact: true })).toBeHidden()
  await expectNoA11yViolations(page)

  // Adding a card ticks the first step off, with no reload.
  await addCard(page, 'el gato', 'the cat')
  await expect(page.getByRole('img', { name: 'Done' })).toHaveCount(1)

  // Practicing it ticks the second off, once the answer is saved.
  await page.getByRole('link', { name: 'Quiz yourself' }).click()
  await page.getByRole('button', { name: 'Reveal' }).click()
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/practice-results') &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Got it!' }).click()
  expect((await saved).ok()).toBe(true)
  await page.getByRole('link', { name: 'Manage cards' }).click()
  await expect(page.getByRole('img', { name: 'Done' })).toHaveCount(2)
  await expect(
    page.getByText("You're all set, Getting! Here's where to go from here."),
  ).toBeVisible()

  // Hiding it is kept by the API, so it stays hidden across a reload, until the preferences page turns it back on.
  const hidden = page.waitForResponse(
    (response) =>
      response.url() === `${apiUrl}/preferences` &&
      response.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: 'Hide guide' }).click()
  expect((await hidden).ok()).toBe(true)
  await expect(
    page.getByRole('heading', { name: 'Getting started' }),
  ).toBeHidden()
  await page.reload()
  await expect(page.getByText('el gato', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Getting started' }),
  ).toBeHidden()

  await page.getByRole('link', { name: 'Preferences' }).click()
  const option = page.getByRole('switch', {
    name: 'Show the getting started guide',
  })
  await expect(option).not.toBeChecked()
  const shown = page.waitForResponse(
    (response) =>
      response.url() === `${apiUrl}/preferences` &&
      response.request().method() === 'PUT',
  )
  await option.click()
  expect((await shown).ok()).toBe(true)
  await page.getByRole('link', { name: 'Manage cards' }).click()
  await expect(
    page.getByRole('heading', { name: 'Getting started' }),
  ).toBeVisible()
})
