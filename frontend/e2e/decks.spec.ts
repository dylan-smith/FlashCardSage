import type { Page } from '@playwright/test'
import { test, expect, cardData } from './fixtures'

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
        (
          await request.post(`${apiUrl}/flashcards`, {
            data: cardData(card.spanish, card.english, card.tags),
          })
        ).ok(),
      ).toBe(true)
    }
  })

  test('makes a deck from a tag and a card, then practices only its cards', async ({
    page,
  }) => {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Manage cards' })
      .getByRole('link', { name: 'Decks' })
      .click()
    await expect(
      page.getByText("You haven't made any decks yet."),
    ).toBeVisible()

    await page.getByLabel('Deck name').fill('Week 1')
    await page.getByRole('button', { name: 'Create deck' }).click()

    // A new deck opens on adding cards. All of a tag's cards go in at once.
    await expect(page).toHaveURL(/\/decks\/\d+$/)
    await expect(
      page.getByRole('tab', { name: 'Add cards (4)' }),
    ).toHaveAttribute('aria-selected', 'true')
    await page
      .getByRole('group', { name: 'Show cards tagged' })
      .getByRole('button', { name: 'Animals (2)' })
      .click()
    await page.getByRole('checkbox', { name: 'Pick all 2' }).check()
    await page.getByRole('button', { name: 'Add 2 cards' }).click()
    await expect(page.getByRole('status')).toHaveText(
      'Added 2 cards to the deck.',
    )

    // Then a card found by searching.
    await page.getByRole('searchbox', { name: 'Search' }).fill('house')
    await page.getByRole('checkbox', { name: 'Pick "la casa"' }).check()
    await page.getByRole('button', { name: 'Add 1 card' }).click()
    await expect(page.getByRole('status')).toHaveText(
      'Added 1 card to the deck.',
    )

    // Still there after a reload, so it was saved.
    await page.reload()
    await expect(
      page.getByRole('tab', { name: 'In this deck (3)' }),
    ).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('link', { name: 'Practice deck "Week 1"' }).click()
    await expect(page).toHaveURL(/\/practice\?deck=\d+$/)
    await expect(page.getByRole('combobox', { name: 'Practice' })).toHaveText(
      'Deck: Week 1',
    )
    await practiceOnly(page, ['el gato', 'el perro', 'la casa'])
  })

  test('puts cards picked on the cards page into a new deck, and takes one out again', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('checkbox', { name: 'Pick "la casa"' }).check()
    await page.getByRole('checkbox', { name: 'Pick "el libro"' }).check()
    await page.getByRole('button', { name: 'Add 2 cards to deck…' }).click()
    await page.getByRole('menuitem', { name: 'New deck…' }).click()
    const dialog = page.getByRole('dialog', { name: 'New deck with 2 cards' })
    await dialog.getByLabel('Deck name').fill('Things')
    await dialog.getByRole('button', { name: 'Create deck' }).click()

    const status = page.getByRole('status')
    await expect(status).toHaveText('Added 2 cards to Things.')
    await status.getByRole('link', { name: 'Things' }).click()

    await expect(page.getByRole('heading', { name: 'Things' })).toBeVisible()
    await page.getByRole('checkbox', { name: 'Pick "el libro"' }).check()
    await page.getByRole('button', { name: 'Remove 1 card' }).click()
    await expect(
      page.getByRole('tab', { name: 'In this deck (1)' }),
    ).toBeVisible()
    await expect(
      page.getByRole('checkbox', { name: 'Pick "la casa"' }),
    ).toBeVisible()
  })

  test("deletes a card from a deck's page, so it's gone from the cards page too", async ({
    page,
  }) => {
    await page.goto('/decks')
    await page.getByLabel('Deck name').fill('House')
    await page.getByRole('button', { name: 'Create deck' }).click()
    await page.getByRole('checkbox', { name: 'Pick "la casa"' }).check()
    await page.getByRole('button', { name: 'Add 1 card' }).click()
    await page.getByRole('tab', { name: 'In this deck (1)' }).click()

    await page.getByRole('button', { name: 'Delete "la casa"' }).click()
    await expect(page.getByRole('status')).toHaveText('Deleted "la casa".')
    await expect(
      page.getByRole('tab', { name: 'In this deck (0)' }),
    ).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Add cards (3)' })).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Manage cards' })
      .getByRole('link', { name: 'Cards', exact: true })
      .click()
    await expect(page.getByText('el libro', { exact: true })).toBeVisible()
    await expect(page.getByText('la casa', { exact: true })).toBeHidden()
  })

  test('practices only the cards with the tag picked', async ({ page }) => {
    await page.goto('/practice')
    await page.getByRole('combobox', { name: 'Practice' }).click()
    await page.getByRole('option', { name: 'Tag: Animals' }).click()

    await expect(page).toHaveURL(/\/practice\?tag=\d+$/)
    await practiceOnly(page, ['el gato', 'el perro'])
  })
})
