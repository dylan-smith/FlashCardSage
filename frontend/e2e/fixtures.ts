import { test as base } from '@playwright/test'

// The E2E backend has test sign-in turned on (see playwright.config.ts), so the tests sign in as a test user: pages
// start with the user's session saved, as if they'd signed in before, and API calls send the user's token.
export const e2eUserName = 'E2E User'

export const e2eToken = `test:${e2eUserName}`

// The session the frontend saves in localStorage (see src/auth/session.ts).
export function sessionStorageEntry(name: string, token = `test:${name}`) {
  return {
    name: 'flashcardsage.session',
    value: JSON.stringify({ token, name, provider: 'test' }),
  }
}

export const test = base.extend({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:4173',
        localStorage: [sessionStorageEntry(e2eUserName)],
      },
    ],
  },
  // Only the API calls the tests make themselves get the header, so the pages have to send the token on their own.
  request: async ({ playwright }, provide) => {
    const request = await playwright.request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${e2eToken}` },
    })
    await provide(request)
    await request.dispose()
  },
})

// The body that makes a card with one Spanish word and one English word through the API, which takes a list of words
// for each side.
export function cardData(
  spanish: string,
  english: string,
  tags: string[] = [],
) {
  return { spanish: [spanish], english: [english], tags }
}

// A picture for a card: a one-pixel PNG, as the API's generate endpoint would return one. The E2E backend has no
// image generator, so the tests stand in for it with this.
export const onePixelPng = {
  contentType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
}

export { expect } from '@playwright/test'
