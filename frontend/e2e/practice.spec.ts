import { test, expect, openSection } from './fixtures'

const cards = [
  { spanish: 'el gato', english: 'the cat' },
  { spanish: 'el perro', english: 'the dog' },
]

test.describe('Practice', () => {
  test.beforeEach(async ({ api }) => {
    // Start from just these cards, so the one shown is always one of them.
    await api.reset('flashcards')
    for (const card of cards) {
      await api.createCard(card.spanish, card.english)
    }
  })

  test('reveals a card, records the answer and moves on to the other card', async ({
    page,
  }) => {
    await page.goto('/')
    await openSection(page, 'Practice', 'Mode')
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible()

    // Either side of either card can come up, so find which one it is from the text shown. The card is on the
    // page by the time Reveal is.
    const candidates = cards.flatMap((card, index) => [
      {
        shownSide: card.spanish,
        hiddenSide: card.english,
        other: cards[1 - index],
      },
      {
        shownSide: card.english,
        hiddenSide: card.spanish,
        other: cards[1 - index],
      },
    ])
    const visible = await Promise.all(
      candidates.map(({ shownSide }) =>
        page.getByText(shownSide, { exact: true }).isVisible(),
      ),
    )
    const prompts = candidates.filter((_, index) => visible[index])
    expect(prompts).toHaveLength(1)
    const [{ shownSide, hiddenSide, other }] = prompts
    await expect(page.getByText(hiddenSide, { exact: true })).toBeHidden()

    await page.getByRole('button', { name: 'Reveal' }).click()

    await expect(page.getByText(hiddenSide, { exact: true })).toBeVisible()
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/practice-results') &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'I was close' }).click()

    expect((await saved).status()).toBe(200)
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible()
    await expect(
      page
        .getByText(other.spanish, { exact: true })
        .or(page.getByText(other.english, { exact: true })),
    ).toBeVisible()
    await expect(page.getByText(shownSide, { exact: true })).toBeHidden()
  })

  test('reads the Spanish aloud when Listen is pressed', async ({ page }) => {
    // The audio is asked for as soon as the card comes up, whichever side is showing.
    const asked = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/speech') &&
        response.request().method() === 'POST',
    )
    await page.goto('/practice')
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible()
    const spoken = await asked
    expect(spoken.status()).toBe(200)
    const { urls } = (await spoken.json()) as { urls: string[] }
    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(/\/card-images\/[0-9a-f]{32}\.mp3$/)
    // The audio is played by the browser like any media, without the user's token.
    const audio = await page.request.get(urls[0])
    expect(audio.ok()).toBe(true)
    expect(audio.headers()['content-type']).toBe('audio/mpeg')

    // Listen is beside the Spanish, which the card may keep hidden until it's revealed.
    await page.getByRole('button', { name: 'Reveal' }).click()
    const listen = page.getByRole('button', { name: 'Listen' })
    await listen.click()

    // The sample audio is a short silence: Stop while it plays, then Listen again.
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
    await expect(listen).toBeVisible()
    await expect(page.getByRole('alert')).toBeHidden()
  })

  test('keeps a running score for the session', async ({ page }) => {
    await page.goto('/practice')
    const sessionScore = page.getByText(/^Session score/)
    await expect(sessionScore).toHaveText('Session score 0')

    // Both cards are new, so whichever comes up goes from 0 to 50.
    await page.getByRole('button', { name: 'Reveal' }).click()
    await page.getByRole('button', { name: 'Got it!' }).click()
    await expect(sessionScore).toHaveText('Session score +50')

    // Failed leaves the other card at 0, or drops the same one back to 0, whichever comes up next.
    await page.getByRole('button', { name: 'Reveal' }).click()
    await page.getByRole('button', { name: 'Failed :(' }).click()
    await expect(sessionScore).toHaveText(/^Session score (\+50|0)$/)
  })

  test("shows the card's picture once it's revealed", async ({ page, api }) => {
    // Only one card, with a picture, so it's the one that comes up.
    const [first, ...rest] = await api.list('flashcards')
    for (const { id } of rest) {
      await api.deleteCard(id)
    }
    await api.addPicture(first.id)

    await page.goto('/practice')
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible()
    await expect(page.getByRole('img', { name: /^Picture for/ })).toBeHidden()

    await page.getByRole('button', { name: 'Reveal' }).click()

    const picture = page.getByRole('img', { name: /^Picture for/ })
    await expect(picture).toBeVisible()

    // To the left of the card's text on a wide screen, and below it on a phone.
    const text = page.getByText(first.spanish[0], { exact: true })
    async function box(locator: typeof picture) {
      const found = await locator.boundingBox()
      expect(found).not.toBeNull()
      return found ?? { x: 0, y: 0, width: 0, height: 0 }
    }
    let pictureBox = await box(picture)
    let textBox = await box(text)
    expect(pictureBox.x + pictureBox.width).toBeLessThanOrEqual(textBox.x)

    await page.setViewportSize({ width: 375, height: 800 })
    pictureBox = await box(picture)
    textBox = await box(text)
    expect(pictureBox.y).toBeGreaterThanOrEqual(textBox.y + textBox.height)
  })

  for (const viewport of [
    { width: 360, height: 640 },
    { width: 390, height: 664 },
    { width: 667, height: 375 },
  ]) {
    test(`keeps a revealed card and its picture on a ${viewport.width}x${viewport.height} screen`, async ({
      page,
      api,
    }) => {
      // Only one card, with long words and a picture, so it's the one that comes up.
      await api.reset('flashcards')
      const { id } = await api.createCard(
        'el perro grande y simpático',
        'the big and friendly dog',
      )
      await api.addPicture(id)

      await page.setViewportSize(viewport)
      await page.goto('/practice')
      await page.getByRole('button', { name: 'Reveal' }).click()

      // All of it on the screen at once, without the user scrolling.
      for (const locator of [
        page.getByText('el perro grande y simpático', { exact: true }),
        page.getByText('the big and friendly dog', { exact: true }),
        page.getByRole('img', { name: /^Picture for/ }),
        page.getByRole('button', { name: 'Got it!' }),
        page.getByRole('button', { name: 'I was close' }),
        page.getByRole('button', { name: 'Failed :(' }),
      ]) {
        await expect(locator).toBeInViewport({ ratio: 1 })
      }
      // Still a picture worth showing, not squashed to nothing.
      const picture = await page
        .getByRole('img', { name: /^Picture for/ })
        .boundingBox()
      expect(picture?.height).toBeGreaterThanOrEqual(120)
    })
  }

  test('points to adding cards when there are none', async ({ page, api }) => {
    await api.reset('flashcards')

    await page.goto('/practice')
    await expect(
      page.getByText('There are no flash cards to practice yet.'),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Add flash cards' }).click()

    await expect(
      page.getByRole('heading', { name: 'Add flash card' }),
    ).toBeVisible()
  })
})
