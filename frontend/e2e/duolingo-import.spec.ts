import type { Route } from '@playwright/test'
import { expectNoA11yViolations, test, expect } from './fixtures'

const duolingoWordsUrl = 'https://www.duolingo.com/practice-hub/words'

// The user's id, as Duolingo's sign-in token names them.
const userId = 377403869
const jwt = `header.${Buffer.from(JSON.stringify({ sub: userId })).toString('base64url')}.signature`

// The words in the stand-in Duolingo word list, in two pages as Duolingo's API sends them. "a" and "para" share "for",
// so only "a" keeps it.
const pages = [
  [
    { text: 'a', translations: ['to', 'at', 'for'] },
    { text: 'lunes', translations: ['Monday'] },
  ],
  [
    { text: 'para', translations: ['for', 'in order to'] },
    { text: 'picante', translations: ['spicy'] },
  ],
]

// Stands in for www.duolingo.com: a page for the bookmarklet to run on, and the API it reads the course and words from.
async function fakeDuolingo(route: Route) {
  const request = route.request()
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/2017-06-30/')) {
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Duolingo</title><h1>Words</h1>',
    })
    return
  }

  // The API takes the sign-in from the cookie, as Duolingo's own page sends it.
  expect(request.headers()['authorization']).toBe(`Bearer ${jwt}`)
  if (url.pathname === `/2017-06-30/users/${userId}`) {
    await route.fulfill({
      json: {
        currentCourse: {
          learningLanguage: 'es',
          fromLanguage: 'en',
          pathSectioned: [
            {
              units: [
                {
                  levels: [
                    {
                      state: 'passed',
                      finishedSessions: 4,
                      pathLevelMetadata: { skillId: 'cafe' },
                    },
                    {
                      state: 'locked',
                      finishedSessions: 0,
                      pathLevelMetadata: { skillId: 'travel' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    })
    return
  }
  if (url.pathname.endsWith('/courses/es/en/learned-lexemes')) {
    expect(request.postDataJSON()).toEqual({
      lastTotalLexemeCount: 0,
      progressedSkills: [
        { finishedLevels: 1, finishedSessions: 4, skillId: { id: 'cafe' } },
      ],
    })
    const index = url.searchParams.get('startIndex') === '0' ? 0 : 1
    await route.fulfill({
      json: {
        learnedLexemes: pages[index],
        pagination: {
          totalLexemes: 4,
          nextStartIndex: index === 0 ? 2 : null,
        },
      },
    })
    return
  }
  await route.fulfill({ status: 404 })
}

test.describe('Import from Duolingo', () => {
  test.beforeEach(async ({ api, context }) => {
    // Start from one card the Duolingo word list has too, with no decks or tags, as preply-import.spec.ts does.
    await api.reset('decks', 'flashcards', 'tags')
    await api.createCard('lunes', 'Monday')
    // Signed in to Duolingo, as its cookie says.
    await context.addCookies([
      { name: 'jwt_token', value: jwt, domain: 'www.duolingo.com', path: '/' },
    ])
  })

  test('the steps have no detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/import?from=duolingo')
    await expect(
      page.getByRole('link', { name: 'Send to FlashCardSage' }),
    ).toHaveAttribute('href', /^javascript:/)

    await expectNoA11yViolations(page)
  })

  test('the bookmarklet brings the Duolingo words into a new deck', async ({
    page,
    context,
  }) => {
    await context.route('https://www.duolingo.com/**', fakeDuolingo)

    await page.goto('/import')
    await page.getByRole('tab', { name: 'From Duolingo' }).click()
    await expect(page).toHaveURL(/\/import\?from=duolingo$/)
    const bookmarklet = page.getByRole('link', {
      name: 'Send to FlashCardSage',
    })
    await expect(bookmarklet).toHaveAttribute('href', /^javascript:/)
    const href = (await bookmarklet.getAttribute('href')) ?? ''
    const source = decodeURIComponent(href.slice('javascript:'.length))

    // Clicking the bookmark on Duolingo runs it there, and it opens FlashCardSage.
    const duolingo = await context.newPage()
    await duolingo.goto(duolingoWordsUrl)
    const opened = context.waitForEvent('page')
    await duolingo.evaluate(source)
    const importPage = await opened
    // It opens on the Import cards page's Duolingo tab.
    await expect(importPage).toHaveURL(/\/import\?from=duolingo$/)
    await expect(
      importPage.getByRole('tab', { name: 'From Duolingo' }),
    ).toHaveAttribute('aria-selected', 'true')

    // Listed like the cards from a document, leaving out the word the user has a card for, with "for" only on the
    // first card that has it.
    const cards = importPage.getByRole('list', { name: 'Cards from Duolingo' })
    await expect(cards.getByRole('listitem')).toHaveCount(3)
    await expect(
      cards.getByText('to / at / for', { exact: true }),
    ).toBeVisible()
    await expect(cards.getByText('in order to', { exact: true })).toBeVisible()
    await expect(
      importPage.getByText(
        '1 word is left out because you already have a card for it.',
      ),
    ).toBeVisible()

    // Removed, changed with the cards page's form, and added one at a time and all at once.
    await importPage.getByRole('button', { name: 'Remove "picante"' }).click()
    await importPage.getByRole('button', { name: 'Edit "para"' }).click()
    await importPage.getByLabel('English', { exact: true }).fill('so that')
    await importPage.getByRole('button', { name: 'Save' }).click()
    await expect(cards.getByText('so that', { exact: true })).toBeVisible()
    await importPage.getByRole('button', { name: 'Add "a"' }).click()
    await expect(
      importPage.getByText('Added “a” to your Duolingo deck.'),
    ).toBeVisible()
    // The one above the list. There's another below it.
    await importPage.getByRole('button', { name: 'Add 1 card' }).first().click()

    await expect(
      importPage.getByText('Added 2 cards to your Duolingo deck.'),
    ).toBeVisible()
    await importPage.getByRole('link', { name: 'Open deck' }).click()

    await expect(
      importPage.getByRole('tab', { name: 'In this deck (2)' }),
    ).toBeVisible()
    await expect(
      importPage.getByText('to / at / for', { exact: true }),
    ).toBeVisible()
    await expect(importPage.getByText('so that', { exact: true })).toBeVisible()
    await expect(importPage.getByText('picante', { exact: true })).toHaveCount(
      0,
    )
  })
})

test.describe('Import from Duolingo on a phone', () => {
  // A phone's touch screen, which has no bookmarks bar to drag the bookmarklet to.
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })

  test('says to bring the words in on a computer', async ({ page }) => {
    await page.goto('/import?from=duolingo')

    await expect(
      page.getByText(/Bringing in your Duolingo words needs a computer\./),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Send to FlashCardSage' }),
    ).toHaveCount(0)
  })
})
