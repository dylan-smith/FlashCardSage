import { createHash, randomBytes } from 'node:crypto'
import { test, expect, apiOrigin, expectNoA11yViolations } from './fixtures'

// A user of their own, so the app connected here is the only one on Connected apps.
test.use({ userName: `OAuth Tester ${Date.now()}` })

// Where the app is listening for the user to come back, as an MCP client on the user's own computer does (such as
// Claude Code). It registers the loopback URL with no port, and the API accepts it on any port.
const callbackOrigin = 'http://127.0.0.1:43123'

test('the user approves an app on the consent page and can disconnect it', async ({
  page,
  request,
}) => {
  // The app registers itself, as ChatGPT and other MCP clients do.
  const registered = await request.post(`${apiOrigin}/oauth/register`, {
    data: {
      client_name: 'E2E Assistant',
      redirect_uris: ['http://127.0.0.1/cb'],
    },
  })
  expect(registered.status()).toBe(201)
  const { client_id: clientId } = (await registered.json()) as {
    client_id: string
  }

  // Nothing listens on the app's port, so stand in for it.
  let callback: URL | undefined
  await page.route(
    (url) => url.origin === callbackOrigin && url.pathname === '/cb',
    async (route) => {
      callback = new URL(route.request().url())
      await route.fulfill({ contentType: 'text/html', body: 'Connected' })
    },
  )

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const authorize = new URL(`${apiOrigin}/oauth/authorize`)
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `${callbackOrigin}/cb`,
    scope: 'flashcards',
    state: 'e2e-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${apiOrigin}/mcp`,
  }).toString()

  // The API sends the browser on to the consent page.
  await page.goto(authorize.toString())
  await expect(
    page.getByText(
      'E2E Assistant (a name the app gave itself) wants to read and change your flash cards.',
    ),
  ).toBeVisible()
  await expect(page.getByText(/you'll go back to 127\.0\.0\.1/)).toBeVisible()
  await expectNoA11yViolations(page)

  await page.getByRole('button', { name: 'Approve' }).click()

  await page.waitForURL((url) => url.origin === callbackOrigin)
  expect(callback?.pathname).toBe('/cb')
  expect(callback?.searchParams.get('code')).toMatch(/^fcs_ac_/)
  expect(callback?.searchParams.get('state')).toBe('e2e-state')

  // The app is on Connected apps, from where the user can disconnect it.
  await page.goto('/preferences')
  const apps = page.getByRole('list', { name: 'Connected apps' })
  await expect(apps.getByRole('listitem')).toHaveCount(1)
  await expect(apps.getByText('E2E Assistant')).toBeVisible()
  await expectNoA11yViolations(page)

  await page.getByRole('button', { name: 'Disconnect E2E Assistant' }).click()
  await page
    .getByRole('dialog', { name: 'Disconnect E2E Assistant?' })
    .getByRole('button', { name: 'Disconnect' })
    .click()
  await expect(page.getByText(/You haven't connected any apps/)).toBeVisible()
})
