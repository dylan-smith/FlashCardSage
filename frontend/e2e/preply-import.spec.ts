import AxeBuilder from '@axe-core/playwright'
import type { Route } from '@playwright/test'
import { cardData, test, expect } from './fixtures'

const apiUrl = 'http://localhost:5269/api'

const preplyVocabularyUrl =
  'https://preply.com/en/practice/vocab-bank?subject=spanish'

// The words in the stand-in Preply vocabulary, in two pages as Preply's GraphQL API sends them. tostado and tostada
// share their English, so they're one card.
const pages = [
  [
    { spelling: 'lunes', english: 'Monday' },
    { spelling: 'tostado', english: 'toasted' },
  ],
  [
    { spelling: 'avena', english: 'oatmeal' },
    { spelling: 'picante', english: 'spicy' },
    { spelling: 'tostada', english: 'toasted' },
  ],
]

// Stands in for preply.com: a page for the bookmarklet to run on, and the GraphQL API it reads the words from.
async function fakePreply(route: Route) {
  const request = route.request()
  if (!request.url().endsWith('/graphql/v2/')) {
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Preply</title><h1>My vocabulary</h1>',
    })
    return
  }

  const { variables } = request.postDataJSON() as {
    variables: { after: string | null; subjectAlias: string }
  }
  expect(variables.subjectAlias).toBe('spanish')
  const index = variables.after === null ? 0 : 1
  await route.fulfill({
    json: {
      data: {
        vocabularyBank: {
          vocabularyBank: {
            hasNext: index === 0,
            endCursor: index === 0 ? 'page-2' : null,
            nodes: pages[index].map(({ spelling, english }) => ({
              termDefinition: {
                spelling,
                translation: null,
                definition: {
                  translation: { translation: english },
                  lemma: { typeLabel: 'noun' },
                },
              },
            })),
          },
        },
      },
    },
  })
}

test.describe('Import from Preply', () => {
  test.beforeEach(async ({ request }) => {
    // Start from one card the Preply vocabulary has too, with no decks or tags, as import.spec.ts does.
    for (const resource of ['decks', 'flashcards', 'tags']) {
      const response = await request.get(`${apiUrl}/${resource}`)
      expect(response.ok()).toBe(true)
      for (const { id } of (await response.json()) as { id: number }[]) {
        expect((await request.delete(`${apiUrl}/${resource}/${id}`)).ok()).toBe(
          true,
        )
      }
    }
    expect(
      (
        await request.post(`${apiUrl}/flashcards`, {
          data: cardData('lunes', 'Monday'),
        })
      ).ok(),
    ).toBe(true)
  })

  test('the steps have no detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/import?from=preply')
    await expect(
      page.getByRole('link', { name: 'Send to FlashCardSage' }),
    ).toHaveAttribute('href', /^javascript:/)

    const results = await new AxeBuilder({ page }).analyze()

    expect(results.violations).toEqual([])
  })

  test('the bookmarklet brings the Preply words into a new deck', async ({
    page,
    context,
  }) => {
    await context.route('https://preply.com/**', fakePreply)

    await page.goto('/import')
    await page.getByRole('tab', { name: 'From Preply' }).click()
    await expect(page).toHaveURL(/\/import\?from=preply$/)
    const bookmarklet = page.getByRole('link', {
      name: 'Send to FlashCardSage',
    })
    await expect(bookmarklet).toHaveAttribute('href', /^javascript:/)
    const href = (await bookmarklet.getAttribute('href')) ?? ''
    const source = decodeURIComponent(href.slice('javascript:'.length))

    // Clicking the bookmark on Preply runs it there, and it opens FlashCardSage.
    const preply = await context.newPage()
    await preply.goto(preplyVocabularyUrl)
    const opened = context.waitForEvent('page')
    await preply.evaluate(source)
    const importPage = await opened
    // It opens on the Import cards page's Preply tab.
    await expect(importPage).toHaveURL(/\/import\?from=preply$/)
    await expect(
      importPage.getByRole('tab', { name: 'From Preply' }),
    ).toHaveAttribute('aria-selected', 'true')

    // Listed like the cards from a document, leaving out the word the user has a card for, with the two words for
    // "toasted" on one card.
    const cards = importPage.getByRole('list', { name: 'Cards from Preply' })
    await expect(cards.getByRole('listitem')).toHaveCount(3)
    await expect(
      cards.getByText('tostado / tostada', { exact: true }),
    ).toBeVisible()
    await expect(
      importPage.getByText(
        '1 word is left out because you already have a card for it.',
      ),
    ).toBeVisible()

    // Removed, changed with the cards page's form, and added one at a time and all at once.
    await importPage.getByRole('button', { name: 'Remove "picante"' }).click()
    await importPage.getByRole('button', { name: 'Edit "avena"' }).click()
    await importPage.getByLabel('English', { exact: true }).fill('oats')
    await importPage.getByRole('button', { name: 'Save' }).click()
    await expect(cards.getByText('oats', { exact: true })).toBeVisible()
    await importPage
      .getByRole('button', { name: 'Add "tostado / tostada"' })
      .click()
    await expect(
      importPage.getByText('Added “tostado / tostada” to your Preply deck.'),
    ).toBeVisible()
    // The one above the list. There's another below it.
    await importPage.getByRole('button', { name: 'Add 1 card' }).first().click()

    await expect(
      importPage.getByText('Added 2 cards to your Preply deck.'),
    ).toBeVisible()
    await importPage.getByRole('link', { name: 'Open deck' }).click()

    await expect(
      importPage.getByRole('tab', { name: 'In this deck (2)' }),
    ).toBeVisible()
    await expect(
      importPage.getByText('tostado / tostada', { exact: true }),
    ).toBeVisible()
    await expect(importPage.getByText('oats', { exact: true })).toBeVisible()
    await expect(importPage.getByText('picante', { exact: true })).toHaveCount(
      0,
    )
  })

  // The bookmarklet sends the words once, so the page it opened, reloaded after they're added, waits for nothing.
  test('a reloaded page can stop waiting and offer the steps again', async ({
    page,
    context,
  }) => {
    await context.route('https://preply.com/**', fakePreply)
    await page.goto('/import?from=preply')
    const bookmarklet = page.getByRole('link', {
      name: 'Send to FlashCardSage',
    })
    await expect(bookmarklet).toHaveAttribute('href', /^javascript:/)
    const href = (await bookmarklet.getAttribute('href')) ?? ''
    const preply = await context.newPage()
    await preply.goto(preplyVocabularyUrl)
    const opened = context.waitForEvent('page')
    await preply.evaluate(decodeURIComponent(href.slice('javascript:'.length)))
    const importPage = await opened
    await importPage
      .getByRole('button', { name: 'Add all 3 cards' })
      .first()
      .click()
    await expect(
      importPage.getByText(/^Added 3 cards to your Preply deck\./),
    ).toBeVisible()

    await importPage.reload()

    await expect(
      importPage.getByText('Getting your words from Preply…'),
    ).toBeVisible()
    await importPage.getByRole('button', { name: 'Stop waiting' }).click()
    await expect(
      importPage.getByRole('link', { name: 'Send to FlashCardSage' }),
    ).toBeVisible()
  })
})

test.describe('Import from Preply on a phone', () => {
  // A phone's touch screen, which has no bookmarks bar to drag the bookmarklet to.
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })

  test('says to bring the words in on a computer', async ({ page }) => {
    await page.goto('/import?from=preply')

    await expect(
      page.getByText(/Bringing in your Preply words needs a computer\./),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Send to FlashCardSage' }),
    ).toHaveCount(0)
  })
})
