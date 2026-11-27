import { storageKeys } from './storageKeys'

// Which of the app's clients this is: the Android app, which shows the site full-screen, or the website. The API is
// told with each request (see apiFetch), so the admin pages can show which of them people use.
export type AppClient = 'android' | 'web'

// The header the API reads the client from.
export const appClientHeader = 'X-FlashCardSage-Client'

// What the page's referrer starts with when the Android app opened it (the app's package, from twa-manifest.json).
const androidAppReferrer = 'android-app://com.flashcardsage.app'

function remembered() {
  try {
    return sessionStorage.getItem(storageKeys.appClient) === 'android'
  } catch {
    // Storage can be turned off.
    return false
  }
}

export function getAppClient(): AppClient {
  if (document.referrer.startsWith(androidAppReferrer)) {
    try {
      sessionStorage.setItem(storageKeys.appClient, 'android')
    } catch {
      // It's still known for as long as the page has this referrer.
    }
    return 'android'
  }
  return remembered() ? 'android' : 'web'
}
