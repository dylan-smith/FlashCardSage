import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

// The backend started by playwright.config.ts.
const apiUrl = 'http://localhost:5269/api'

const cards = [
  { spanish: 'el gato', english: 'the cat', tags: ['Animals'] },
  { spanish: 'el perro', english: 'the dog', tags: ['Animals'] },
  { spanish: 'la casa', english: 'the house', tags: [] },
  { spanish: 'el libro', english: 'the book', tags: [] },
]

// Answers a few cards with Got it!, checking each one shown is one of these. The API picks at random, so it's
// asked more than once. Both sides are shown once a card is revealed, so its Spanish is on the page whichever side
// came up first.
async function practiceOnly(page: Page, allowed: string[]) {
  const others = cards.filter((card) => !allowed.includes(card.spanish))
  for (let answer = 0; answer < 4; answer++) {
    await page.getByRole('button', { name: 'Reveal' }).click()
    await expect(
      page.getByText(new RegExp(`^(${allowed.join('|')})$`)),
    ).toBeVisible()
    for (const card of others) {
      await expect(page.getByText(card.spanish, { exact: true })).toBeHidden()
    }
    await page.getByRole('button', { name: 'Got it!' }).click()
  }
}

test.describe('Decks', () => {
  test.beforeEach(async ({ request }) => {
    // Start from just these cards, with no decks or tags, deleted through the API like tags.spec.ts does.
    for (const resource of ['decks', 'flashcards', 'tags']) {
      const response = await request.get(`${apiUrl}/${resource}`)
      expect(response.ok()).toBe(true)
      for (const { id } of (await response.json()) as { id: number }[]) {
        expect((await request.delete(`${apiUrl}/${resource}/${id}`)).ok()).toBe(
          true,
        )
      }
    }
    for (const card of cards) {
      expect(
        (await request.post(`${apiUrl}/flashcards`, { data: card })).ok(),
      ).toBe(true)
    }
  })

  test('makes a deck from a tag and a card, then practices only its cards', async ({
    page,
  }) => {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Mode' })
      .getByRole('link', { name: 'Decks' })
      .click()
    await expect(
      page.getByText("You haven't made any decks yet."),
    ).toBeVisible()

    await page.getByLabel('Deck name').fill('Week 1')
    await page
      .getByRole('group', { name: 'Add the cards tagged' })
      .getByRole('button', { name: 'Animals' })
      .click()
    await page.getByRole('combobox', { name: 'Cards' }).click()
    await page.getByRole('option', { name: 'la casa — the house' }).click()
    await page.getByRole('button', { name: 'Create deck' }).click()

    const deck = page.getByRole('listitem').filter({ hasText: 'Week 1' })
    await expect(deck).toContainText('3 cards')

    // Still there after a reload, so it was saved.
    await page.reload()
    await expect(deck).toContainText('3 cards')

    await page.getByRole('link', { name: 'Practice deck "Week 1"' }).click()
    await expect(page).toHaveURL(/\/practice\?deck=\d+$/)
    await expect(page.getByRole('combobox', { name: 'Practice' })).toHaveText(
      'Deck: Week 1',
    )
    await practiceOnly(page, ['el gato', 'el perro', 'la casa'])
  })

  test('practices only the cards with the tag picked', async ({ page }) => {
    await page.goto('/practice')
    await page.getByRole('combobox', { name: 'Practice' }).click()
    await page.getByRole('option', { name: 'Tag: Animals' }).click()

    await expect(page).toHaveURL(/\/practice\?tag=\d+$/)
    await practiceOnly(page, ['el gato', 'el perro'])
  })
})
