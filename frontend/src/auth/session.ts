import { storageKeys } from '../lib/storageKeys'
import { createStore } from '../lib/store'
import { disableGoogleAutoSelect, googleSubject } from './google'

// The signed-in user. token is sent to the API as a bearer token: a Google ID token, a "test:<name>" token where
// test sign-in is enabled, or the service token the production smoke and load tests use.
export type Session = {
  token: string
  name: string
  email?: string
  pictureUrl?: string
  provider: 'google' | 'test' | 'service'
}

const store = createStore<Session | null>(readStoredSession())

function readStoredSession(): Session | null {
  try {
    const stored = localStorage.getItem(storageKeys.session)
    if (stored === null) {
      return null
    }
    const session = JSON.parse(stored) as Partial<Session>
    return typeof session.token === 'string' && typeof session.name === 'string'
      ? (session as Session)
      : null
  } catch {
    return null
  }
}

export const getSession = store.get

export function setSession(session: Session | null) {
  if (session === store.get()) {
    return
  }
  try {
    if (session === null) {
      localStorage.removeItem(storageKeys.session)
    } else {
      localStorage.setItem(storageKeys.session, JSON.stringify(session))
    }
  } catch {
    // Storage can be unavailable, for example in a private window. The sign-in still lasts until the page reloads.
  }
  store.set(session)
}

// Signs the user out, and stops Google signing them straight back in.
export function signOut() {
  disableGoogleAutoSelect()
  setSession(null)
}

export const subscribeSession = store.subscribe

// The identity the API files the user's data under (see the API's authentication handlers), so what the app
// keeps on the device is kept apart per user too. Test sign-in lowercases the name like the API does.
export function sessionSubject(session: Session): string {
  switch (session.provider) {
    case 'test':
      return `test:${session.token.slice('test:'.length).toLowerCase()}`
    case 'service':
      return 'service:ci'
    default:
      return `google:${googleSubject(session.token) ?? session.email ?? session.name}`
  }
}

// Signing in or out in another tab applies here too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === storageKeys.session) {
      store.set(readStoredSession())
    }
  })
}

export function useSession() {
  return store.use()
}
