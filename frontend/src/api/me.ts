import { apiBaseUrl } from '../config'
import { fetchOk, getJson } from './client'

// The signed-in user as the API knows them. isAdmin: whether they can open the admin pages.
export type Me = {
  displayName: string | null
  email: string | null
  isAdmin: boolean
}

export function getMe(signal?: AbortSignal) {
  return getJson<Me>(`${apiBaseUrl}/api/me`, 'Unable to load your account.', {
    signal,
  })
}

// Deletes the account and everything in it, which the API can't undo.
export async function deleteAccount() {
  await fetchOk(`${apiBaseUrl}/api/me`, 'Unable to delete your account.', {
    method: 'DELETE',
  })
}
