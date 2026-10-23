import {
  test,
  expect,
  expectNoA11yViolations,
  signedInStorage,
} from './fixtures'

// These start signed out, unlike the other specs.
test.use({ storageState: { cookies: [], origins: [] } })

test('shows the landing page and the sign-in until the user signs in', async ({
  page,
}) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', {
      name: 'Spanish flash cards that build themselves',
    }),
  ).toBeVisible()
  await expect(page.locator('video').first()).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Sign in', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Add flash card' }),
  ).toBeHidden()

  await expectNoA11yViolations(page)
})

test('signs in as a test user, keeps the sign-in after a reload, and signs out', async ({
  page,
}) => {
  const name = `Auth Tester ${Date.now()}`
  await page.goto('/')

  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Sign in as test user' }).click()

  await expect(page.getByText(name)).toBeVisible()
  await expect(page.getByText('No flash cards yet.')).toBeVisible()
  await page.reload()
  await expect(page.getByText(name)).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()

  await expect(
    page.getByRole('heading', { name: 'Sign in', exact: true }),
  ).toBeVisible()
})

test('each user only sees their own flash cards', async ({ browser }) => {
  const stamp = Date.now()
  const signedInPage = async (name: string) => {
    const context = await browser.newContext({
      storageState: signedInStorage(name),
    })
    return { context, page: await context.newPage() }
  }
  const alice = await signedInPage(`Alice ${stamp}`)
  const bob = await signedInPage(`Bob ${stamp}`)
  const title = `Alice's card ${stamp}`

  try {
    await alice.page.goto('/')
    await alice.page.getByLabel('Spanish').fill(title)
    await alice.page.getByLabel('English').fill('a test card')
    await alice.page.getByRole('button', { name: 'Add flash card' }).click()
    await expect(alice.page.getByText(title, { exact: true })).toBeVisible()

    await bob.page.goto('/')
    await expect(bob.page.getByText('No flash cards yet.')).toBeVisible()
    await expect(bob.page.getByText(title, { exact: true })).toBeHidden()
  } finally {
    await alice.context.close()
    await bob.context.close()
  }
})
