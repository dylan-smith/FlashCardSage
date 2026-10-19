import { createStore } from '../lib/store'

// Whether the browser says it's online, to tell the user their answers will be saved later. It can say online without
// a working connection, so loading doesn't rely on it alone (see loadPracticePack).
const store = createStore<boolean>(navigator.onLine)

window.addEventListener('online', () => store.set(true))
window.addEventListener('offline', () => store.set(false))

export const isOnline = store.get

export function useOnline() {
  return store.use()
}
