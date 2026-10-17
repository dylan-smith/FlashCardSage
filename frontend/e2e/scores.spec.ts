import { test, expect, openSection } from './fixtures'

test.describe('Scores', () => {
  test.beforeEach(async ({ api }) => {
    // Start from no cards, so the total is just the ones each test adds.
    await api.reset('flashcards')
  })

  test('scores each card from its practice and lists the lowest first', async ({
    page,
    api,
  }) => {
    // The dog is got right twice in a row, and the cat's run is broken by I was close.
    const answers = [
      {
        spanish: 'el perro',
        english: 'the dog',
        outcomes: ['GotIt', 'GotIt'] as const,
      },
      {
        spanish: 'el gato',
        english: 'the cat',
        outcomes: ['GotIt', 'WasClose'] as const,
      },
    ]
    for (const { spanish, english, outcomes } of answers) {
      const { id } = await api.createCard(spanish, english)
      for (const outcome of outcomes) {
        await api.recordPractice(id, outcome)
      }
    }

    await page.goto('/')
    await openSection(page, 'Scores', 'Mode')

    await expect(page.getByText('Total score 80 / 200 (40%)')).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Card scores' }).getByRole('listitem'),
    ).toHaveText([/el gato.*0 \/ 100/, /el perro.*80 \/ 100/])
  })

  test('scores and totals just the cards in the deck picked', async ({
    page,
    api,
  }) => {
    const ids: number[] = []
    for (const [spanish, english] of [
      ['el perro', 'the dog'],
      ['la casa', 'the house'],
    ]) {
      ids.push((await api.createCard(spanish, english)).id)
    }
    await api.recordPractice(ids[0], 'GotIt')
    // Decks outlive the cards deleted before each test, so this one's name is new each run.
    const deckName = `Pets ${Date.now()}`
    await api.createDeck(deckName, [ids[0]])

    await page.goto('/scores')
    await expect(page.getByText('Total score 50 / 200 (25%)')).toBeVisible()
    await page.getByRole('combobox', { name: 'Cards' }).click()
    await page.getByRole('option', { name: `Deck: ${deckName}` }).click()

    await expect(page.getByText('Total score 50 / 100 (50%)')).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Card scores' }).getByRole('listitem'),
    ).toHaveText([/el perro.*50 \/ 100/])
    await expect(page).toHaveURL(/\/scores\?deck=\d+$/)
  })

  test('points to adding cards when there are none', async ({ page }) => {
    await page.goto('/scores')
    await expect(
      page.getByText('There are no flash cards to score yet.'),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Add flash cards' }).click()

    await expect(
      page.getByRole('heading', { name: 'Add flash card' }),
    ).toBeVisible()
  })
})
