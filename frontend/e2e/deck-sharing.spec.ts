import { test, expect, openSection, signedInStorage } from './fixtures'

test.describe('Sharing decks', () => {
  test.beforeEach(async ({ api }) => {
    await api.reset('decks', 'flashcards', 'tags')
  })

  // A teacher's deck for a lesson, with a photo of their own on a card, which a student imports from the zip file.
  test('exports a deck as a file that another user imports, picture and all', async ({
    page,
    api,
    browser,
  }) => {
    const gato = await api.createCard('el gato', 'the cat', ['Animals'])
    const perro = await api.createCard('el perro', 'the dog', ['Animals'])
    await api.addPicture(gato.id)
    const { id } = await api.createDeck('Lesson 3', [gato.id, perro.id])

    await page.goto(`/decks/${id}`)
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export' }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe('Lesson 3.zip')
    const file = await download.path()

    // A new user each run, so they start with no cards.
    const student = await browser.newContext({
      storageState: signedInStorage(`Student ${Date.now()}`),
    })
    try {
      const studentPage = await student.newPage()
      await studentPage.goto('/')
      await openSection(studentPage, 'Decks')
      await studentPage.getByLabel('Import a deck file').setInputFiles(file)

      await expect(
        studentPage.getByRole('heading', { level: 2, name: 'Lesson 3' }),
      ).toBeVisible()
      await expect(studentPage.getByRole('status')).toHaveText(
        'Imported Lesson 3 with 2 cards.',
      )
      await expect(
        studentPage.getByRole('tab', { name: 'In this deck (2)' }),
      ).toHaveAttribute('aria-selected', 'true')
      await expect(
        studentPage.getByRole('img', { name: 'Picture for "el gato"' }),
      ).toBeVisible()
    } finally {
      await student.close()
    }
  })
})
