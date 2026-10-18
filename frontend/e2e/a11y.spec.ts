import { test, expect, expectNoA11yViolations } from './fixtures'

test.describe('Accessibility', () => {
  test('main page has no detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'FlashCardSage' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Add flash card' }),
    ).toBeVisible()
    await expect(page.getByLabel('Loading', { exact: true })).toBeHidden()

    await expectNoA11yViolations(page)
  })

  test('the list, with a card being edited, has no detectable accessibility violations', async ({
    page,
    api,
  }) => {
    const ids: number[] = []
    for (const title of [`A11y card ${Date.now()}`, 'Another a11y card']) {
      ids.push((await api.createCard(title, `${title} in English`)).id)
    }
    // One card with a picture, so the list's thumbnail and the edit form's picture get checked.
    await api.addPicture(ids[1])

    try {
      await page.goto('/')
      await expect(
        page.getByText('Another a11y card', { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('img', { name: 'Picture for "Another a11y card"' }),
      ).toBeVisible()
      // One card in edit mode and one not, so both kinds of list item get checked.
      await page
        .getByRole('button', { name: 'Edit "Another a11y card"' })
        .click()
      await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
      // Once the row has finished shrinking away under the form, so nothing part way through is checked.
      await page.waitForFunction(() => document.getAnimations().length === 0)

      await expectNoA11yViolations(page)
    } finally {
      for (const id of ids) {
        await api.deleteCard(id)
      }
    }
  })

  test('practice page, with a card revealed, has no detectable accessibility violations', async ({
    page,
    api,
  }) => {
    const spanish = `A11y practice ${Date.now()}`
    const { id } = await api.createCard(spanish, `${spanish} in English`)
    // With a picture, so the revealed card's picture gets checked (other specs' cards may come up instead).
    await api.addPicture(id)

    try {
      await page.goto('/practice')
      await page.getByRole('button', { name: 'Reveal' }).click()
      await expect(page.getByRole('button', { name: 'Got it!' })).toBeVisible()

      await expectNoA11yViolations(page)
    } finally {
      await api.deleteCard(id)
    }
  })

  test("decks list, a deck's page with a card picked, the new deck dialog and the Tags page have no detectable accessibility violations", async ({
    page,
    api,
  }) => {
    const { id: cardId } = await api.createCard(
      `A11y deck card ${Date.now()}`,
      'a check',
      ['A11y'],
    )
    const name = `A11y deck ${Date.now()}`
    const { id: deckId } = await api.createDeck(name, [cardId])

    // Checked once nothing is fading in or out, since a button part way from disabled to enabled can fail on
    // contrast.
    async function expectNoViolationsOnceSettled() {
      await page.waitForFunction(() => document.getAnimations().length === 0)
      await expectNoA11yViolations(page)
    }

    try {
      await page.goto('/decks')
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
      await expectNoViolationsOnceSettled()

      await page.getByRole('link', { name, exact: true }).click()
      await page
        .getByRole('checkbox', { name: /^Pick "A11y deck card/ })
        .check()
      await expect(
        page.getByRole('button', { name: 'Remove 1 card from deck' }),
      ).toBeEnabled()
      await expectNoViolationsOnceSettled()

      await page.goto('/')
      await page
        .getByRole('checkbox', { name: /^Pick "A11y deck card/ })
        .check()
      await page.getByRole('button', { name: 'Add 1 card to deck…' }).click()
      await page.getByRole('menuitem', { name: 'New deck…' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await expectNoViolationsOnceSettled()

      // The Tags page, with a tag being renamed.
      await page.goto('/tags')
      await page.getByRole('button', { name: 'Rename tag "A11y"' }).click()
      await expect(page.getByLabel('Tag name', { exact: true })).toBeFocused()
      await expectNoViolationsOnceSettled()
    } finally {
      await api.deleteDeck(deckId)
      await api.deleteCard(cardId)
    }
  })

  test('scores page has no detectable accessibility violations', async ({
    page,
    api,
  }) => {
    const spanish = `A11y scores ${Date.now()}`
    const { id } = await api.createCard(spanish, `${spanish} in English`)

    try {
      await api.recordPractice(id, 'GotIt')
      await page.goto('/scores')
      await expect(page.getByText(spanish, { exact: true })).toBeVisible()

      await expectNoA11yViolations(page)
    } finally {
      await api.deleteCard(id)
    }
  })

  test('not found page has no detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/no/such/page')
    await expect(
      page.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible()

    await expectNoA11yViolations(page)
  })
})
