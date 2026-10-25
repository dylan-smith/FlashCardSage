import type { Page } from '@playwright/test'
import { test, expect, confirmDelete, openSection } from './fixtures'

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
  test.beforeEach(async ({ api }) => {
    // Start from just these cards, with no decks or tags.
    await api.reset('decks', 'flashcards', 'tags')
    for (const card of cards) {
      await api.createCard(card.spanish, card.english, card.tags)
    }
  })

  test('makes a deck from a tag and a card, then practices only its cards', async ({
    page,
  }) => {
    await page.goto('/')
    await openSection(page, 'Decks')
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
    await page.getByRole('button', { name: 'Remove 1 card from deck' }).click()
    await expect(
      page.getByRole('tab', { name: 'In this deck (1)' }),
    ).toBeVisible()
    await expect(
      page.getByRole('checkbox', { name: 'Pick "la casa"' }),
    ).toBeVisible()
  })

  test("removes and deletes cards on a deck's page, one at a time and picked together", async ({
    page,
  }) => {
    await page.goto('/decks')
    await page.getByLabel('Deck name').fill('Everything')
    await page.getByRole('button', { name: 'Create deck' }).click()
    await page.getByRole('checkbox', { name: 'Pick all 4' }).check()
    await page.getByRole('button', { name: 'Add 4 cards' }).click()
    await page.getByRole('tab', { name: 'In this deck (4)' }).click()

    // Removing takes a card out of the deck but keeps it.
    await page
      .getByRole('button', { name: 'Remove from deck "el libro"' })
      .click()
    await expect(page.getByRole('status')).toHaveText(
      'Removed 1 card from the deck.',
    )
    await expect(page.getByRole('tab', { name: 'Add cards (1)' })).toBeVisible()

    // Deleting takes the card away altogether.
    await page.getByRole('button', { name: 'Delete "la casa"' }).click()
    await confirmDelete(page, 'Delete "la casa"?')
    await expect(page.getByRole('status')).toHaveText('Deleted 1 card.')
    await expect(
      page.getByRole('tab', { name: 'In this deck (2)' }),
    ).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Add cards (1)' })).toBeVisible()

    await page.getByRole('checkbox', { name: 'Pick all 2' }).check()
    await page.getByRole('button', { name: 'Delete 2 cards…' }).click()
    await confirmDelete(page, 'Delete 2 cards?')
    await expect(page.getByRole('status')).toHaveText('Deleted 2 cards.')
    await expect(
      page.getByRole('tab', { name: 'In this deck (0)' }),
    ).toBeVisible()

    await openSection(page, /^Cards( \d+)?$/)
    await expect(page.getByText('el libro', { exact: true })).toBeVisible()
    for (const spanish of ['la casa', 'el gato', 'el perro']) {
      await expect(page.getByText(spanish, { exact: true })).toBeHidden()
    }
  })

  test("edits a card on a deck's page", async ({ page }) => {
    await page.goto('/decks')
    await page.getByLabel('Deck name').fill('Everything')
    await page.getByRole('button', { name: 'Create deck' }).click()
    await page.getByRole('checkbox', { name: 'Pick all 4' }).check()
    await page.getByRole('button', { name: 'Add 4 cards' }).click()
    await page.getByRole('tab', { name: 'In this deck (4)' }).click()

    await page.getByRole('button', { name: 'Edit "el gato"' }).click()
    const spanish = page.getByRole('listitem').getByLabel('Spanish')
    await expect(spanish).toHaveValue('el gato')
    await spanish.fill('el gatito')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('el gatito', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save' })).toBeHidden()
    await expect(
      page.getByRole('tab', { name: 'In this deck (4)' }),
    ).toBeVisible()

    // Cancelling keeps the card as it was.
    await page.getByRole('button', { name: 'Edit "la casa"' }).click()
    await page.getByRole('listitem').getByLabel('Spanish').fill('changed')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('la casa', { exact: true })).toBeVisible()

    // The change is to the card itself, so the cards page shows it too.
    await openSection(page, /^Cards( \d+)?$/)
    await expect(page.getByText('el gatito', { exact: true })).toBeVisible()
    await expect(page.getByText('el gato', { exact: true })).toBeHidden()
  })

  test('practices only the cards with the tag picked', async ({ page }) => {
    await page.goto('/practice')
    await page.getByRole('combobox', { name: 'Practice' }).click()
    await page.getByRole('option', { name: 'Tag: Animals' }).click()

    await expect(page).toHaveURL(/\/practice\?tag=\d+$/)
    await practiceOnly(page, ['el gato', 'el perro'])
  })
})
