import { getMe } from '../api/me'
import { createStore } from '../lib/store'
import { trackException } from '../telemetry'

// Whether the signed-in user is an admin, which the app loads when they sign in (see useSignedInUserData). It's false
// until then, and when it can't be loaded, so the admin link only shows once the API says so. The API checks every
// admin request itself, so this only decides what's shown.
const store = createStore<boolean>(false)

export const setIsAdmin = store.set

export function useIsAdmin() {
  return store.use()
}

export function loadAdminStatus(signal: AbortSignal) {
  getMe(signal)
    .then((me) => {
      if (!signal.aborted) {
        setIsAdmin(me.isAdmin)
      }
    })
    .catch((error: unknown) => {
      if (!signal.aborted) {
        trackException(error, { operation: 'loadAdminStatus' })
        setIsAdmin(false)
      }
    })
}
