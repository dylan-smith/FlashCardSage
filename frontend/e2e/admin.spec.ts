import { test, expect, Api, expectNoA11yViolations } from './fixtures'

// The E2E backend makes the test user "Admin" an admin (see playwright.config.ts).
test.use({ userName: 'Admin' })

test('an admin can see every user and what they have', async ({
  page,
  playwright,
}) => {
  // Someone else, with a card in a deck that they've practiced, made through the API as them.
  const otherName = `Admin Spec User ${Date.now()}`
  const request = await playwright.request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer test:${otherName}` },
  })
  const other = new Api(request)
  const card = await other.createCard('el búho', 'the owl', ['Birds'])
  await other.createDeck('Night animals', [card.id])
  await other.recordPractice(card.id, 'WasClose')
  await request.dispose()

  await page.goto('/')
  await page.getByRole('link', { name: 'Admin' }).click()
  await expect(
    page.getByRole('heading', { name: 'All users', level: 2 }),
  ).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search' }).fill(otherName)
  const row = page
    .getByRole('table', { name: 'Users' })
    .getByRole('row')
    .filter({ hasText: otherName })
  await expect(row).toHaveCount(1)
  // Their cards, score (I was close scores nothing), decks, tags and practice results.
  await expect(row.getByRole('cell').nth(5)).toHaveText('1')
  await expect(row.getByRole('cell').nth(6)).toHaveText('0 / 100 (0%)')
  await expect(row.getByRole('cell').nth(7)).toHaveText('1')
  await expect(row.getByRole('cell').nth(8)).toHaveText('1')
  await expect(row.getByRole('cell').nth(9)).toHaveText('1')
  // Move off the admin icon so its tooltip closes: the tooltip sits outside the landmarks, which axe flags.
  await page.mouse.move(0, 0)
  await expect(page.getByRole('tooltip')).toBeHidden()
  await expectNoA11yViolations(page)

  await row.getByRole('link', { name: otherName }).click()
  await expect(
    page.getByRole('heading', { name: otherName, level: 2 }),
  ).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'Decks' }).getByRole('listitem'),
  ).toHaveText(/^Night animals.*1 card$/)
  await expect(
    page.getByRole('list', { name: 'Tags' }).getByRole('listitem'),
  ).toHaveText('Birds1 card')
  await expect(
    page.getByRole('list', { name: 'Recent results' }).getByRole('listitem'),
  ).toHaveText(/^el búho.*Close$/)
  const cardRow = page
    .getByRole('table', { name: 'Cards' })
    .getByRole('row')
    .filter({ hasText: 'el búho' })
  await expect(cardRow).toContainText('the owl')
  await expect(cardRow).toContainText('Added by hand')
  await expectNoA11yViolations(page)
})
