import type { Route } from '@playwright/test'
import { cardData, test, expect } from './fixtures'

const apiUrl = 'http://localhost:5269/api'

const preplyVocabularyUrl =
  'https://preply.com/en/practice/vocab-bank?subject=spanish'

// The words in the stand-in Preply vocabulary, in two pages as Preply's GraphQL API sends them.
const pages = [
  [
    { spelling: 'lunes', english: 'Monday' },
    { spelling: 'tostado', english: 'toasted' },
  ],
  [
    { spelling: 'avena', english: 'oatmeal' },
    { spelling: 'picante', english: 'spicy' },
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

  test('the bookmarklet brings the Preply words into a new deck', async ({
    page,
    context,
  }) => {
    await context.route('https://preply.com/**', fakePreply)

    await page.goto('/import')
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

    const words = importPage.getByRole('list', { name: 'Preply words' })
    await expect(words.getByRole('listitem')).toHaveCount(4)
    await expect(words.getByText('oatmeal · noun')).toBeVisible()

    await words.getByRole('checkbox', { name: 'Pick "picante"' }).uncheck()
    await importPage
      .getByRole('button', { name: 'Add 3 cards to a Preply deck' })
      .click()

    await expect(
      importPage.getByText(
        'Added Preply with 2 cards. 1 card was left out because you already have it.',
      ),
    ).toBeVisible()
    await importPage.getByRole('link', { name: 'Open deck' }).click()

    await expect(
      importPage.getByRole('tab', { name: 'In this deck (2)' }),
    ).toBeVisible()
    await expect(importPage.getByText('tostado', { exact: true })).toBeVisible()
    await expect(importPage.getByText('avena', { exact: true })).toBeVisible()
  })
})
