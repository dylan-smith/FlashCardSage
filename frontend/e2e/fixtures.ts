import AxeBuilder from '@axe-core/playwright'
import { test as base, expect } from '@playwright/test'
import type { APIRequestContext, APIResponse, Page } from '@playwright/test'

// The backend and the frontend started by playwright.config.ts.
export const apiOrigin = 'http://localhost:5269'
export const apiUrl = `${apiOrigin}/api`
const appOrigin = 'http://localhost:4173'

// The E2E backend has test sign-in turned on (see playwright.config.ts), so the tests sign in as a test user: pages
// start with the user's session saved, as if they'd signed in before, and API calls send the user's token.
const e2eUserName = 'E2E User'

// The session the frontend saves in localStorage (see src/auth/session.ts).
function sessionStorageEntry(name: string, token = `test:${name}`) {
  return {
    name: 'flashcardsage.session',
    value: JSON.stringify({ token, name, provider: 'test' }),
  }
}

// A browser's saved state with the user signed in.
export function signedInStorage(name: string) {
  return {
    cookies: [],
    origins: [{ origin: appOrigin, localStorage: [sessionStorageEntry(name)] }],
  }
}

// The body that makes a card with one Spanish word and one English word through the API, which takes a list of words
// for each side.
function cardData(spanish: string, english: string, tags: string[] = []) {
  return { spanish: [spanish], english: [english], tags }
}

// A picture for a card: a one-pixel PNG, as the API's generate endpoint would return one. The E2E backend has no
// image generator, so the tests stand in for it with this.
export const onePixelPng = {
  contentType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
}

// What the user can delete everything of, in the order to delete it in.
type Resource = 'decks' | 'flashcards' | 'tags'

type Created = { id: number }

type Card = Created & { spanish: string[]; english: string[] }

// The user's data through the API, checking that each change it makes goes through.
export class Api {
  readonly request: APIRequestContext

  constructor(request: APIRequestContext) {
    this.request = request
  }

  private async ok(response: Promise<APIResponse>) {
    const done = await response
    expect(done.ok()).toBe(true)
    return done
  }

  // Everything the user has of a resource, such as their cards.
  async list<T extends Created = Card>(resource: Resource) {
    const response = await this.ok(this.request.get(`${apiUrl}/${resource}`))
    return (await response.json()) as T[]
  }

  // Deletes everything the user has of these resources, in order, through the API, since deleting it in the UI races
  // the page's initial load. That includes what other spec files made.
  async reset(...resources: Resource[]) {
    for (const resource of resources) {
      for (const { id } of await this.list<Created>(resource)) {
        await this.ok(this.request.delete(`${apiUrl}/${resource}/${id}`))
      }
    }
  }

  async createCard(spanish: string, english: string, tags: string[] = []) {
    const response = await this.ok(
      this.request.post(`${apiUrl}/flashcards`, {
        data: cardData(spanish, english, tags),
      }),
    )
    return (await response.json()) as Card
  }

  // Puts the one-pixel picture on the card, and gives where it's kept.
  async addPicture(cardId: number) {
    const response = await this.ok(
      this.request.put(`${apiUrl}/flashcards/${cardId}/image`, {
        data: onePixelPng,
      }),
    )
    return (await response.json()) as Card & { imageUrl: string }
  }

  async createDeck(name: string, flashCardIds: number[] = []) {
    const response = await this.ok(
      this.request.post(`${apiUrl}/decks`, { data: { name, flashCardIds } }),
    )
    return (await response.json()) as Created
  }

  async recordPractice(
    cardId: number,
    outcome: 'GotIt' | 'WasClose' | 'Failed',
  ) {
    await this.ok(
      this.request.post(`${apiUrl}/flashcards/${cardId}/practice-results`, {
        data: { outcome },
      }),
    )
  }

  // Deletes a card or deck a test made, without checking, as a test cleans up after itself.
  async deleteCard(id: number) {
    await this.request.delete(`${apiUrl}/flashcards/${id}`)
  }

  async deleteDeck(id: number) {
    await this.request.delete(`${apiUrl}/decks/${id}`)
  }
}

export const test = base.extend<{ userName: string; api: Api }>({
  // Who the tests sign in as. A spec can be someone else with test.use({ userName }).
  userName: [e2eUserName, { option: true }],
  storageState: async ({ userName }, provide) => {
    await provide(signedInStorage(userName))
  },
  // Only the API calls the tests make themselves get the header, so the pages have to send the token on their own.
  request: async ({ playwright, userName }, provide) => {
    const request = await playwright.request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer test:${userName}` },
    })
    await provide(request)
    await request.dispose()
  },
  api: async ({ request }, provide) => {
    await provide(new Api(request))
  },
})

// Adds a flash card with these tags from the form and waits for it to appear in the list.
export async function addCard(
  page: Page,
  spanish: string,
  english: string,
  tags: string[] = [],
) {
  await page.getByLabel('Spanish').fill(spanish)
  await page.getByLabel('English').fill(english)
  const tagsInput = page.getByRole('combobox', { name: 'Tags' })
  for (const tag of tags) {
    await tagsInput.fill(tag)
    await tagsInput.press('Enter')
  }
  await page.getByRole('button', { name: 'Add flash card' }).click()
  await expect(
    page.getByRole('listitem').filter({ hasText: spanish }),
  ).toBeVisible()
}

// Clicks Delete in the dialog that asks whether the user means it.
export async function confirmDelete(page: Page, dialog: string) {
  await page
    .getByRole('dialog', { name: dialog })
    .getByRole('button', { name: 'Delete' })
    .click()
}

// Follows a link in a navigation bar: by default the sections of Manage cards, or the modes with 'Mode'.
export async function openSection(
  page: Page,
  link: string | RegExp,
  navigation = 'Manage cards',
) {
  await page
    .getByRole('navigation', { name: navigation })
    .getByRole('link', { name: link })
    .click()
}

// Axe reads colors as they are on screen, so let the transitions under way (like a nav button turning outlined) end.
export async function expectNoA11yViolations(page: Page) {
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  )
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
}

export { expect }
