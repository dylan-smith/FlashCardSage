import { test, expect, expectNoA11yViolations } from './fixtures'

// A user of their own, since the test deletes their account.
test.use({ userName: `Account Tester ${Date.now()}` })

test('the user can delete their account, and read the privacy policy signed out', async ({
  page,
  api,
}) => {
  await api.createCard('el gato', 'the cat')

  await page.goto('/preferences')
  await page.getByRole('button', { name: 'Delete account' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' })
  const confirm = dialog.getByRole('button', { name: 'Delete account' })
  await expect(confirm).toBeDisabled()
  await expectNoA11yViolations(page)
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE')
  await confirm.click()

  // Deleting signs the user out, and the same sign-in then has a new, empty account.
  await expect(
    page.getByRole('heading', { name: 'Sign in', exact: true }),
  ).toBeVisible()
  expect(await api.list('flashcards')).toEqual([])

  await page.getByRole('link', { name: 'Privacy policy' }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(
    page.getByRole('heading', { name: 'Deleting your account' }),
  ).toBeVisible()
  await expectNoA11yViolations(page)
})
