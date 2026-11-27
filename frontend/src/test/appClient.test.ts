import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { appClientHeader, getAppClient } from '../lib/appClient'
import { api } from './support/factories'
import { mockApi } from './support/mockApi'

function setReferrer(referrer: string) {
  vi.spyOn(document, 'referrer', 'get').mockReturnValue(referrer)
}

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('getAppClient', () => {
  it('is the website in a browser, wherever the page was opened from', () => {
    expect(getAppClient()).toBe('web')

    setReferrer('https://www.google.com/')
    expect(getAppClient()).toBe('web')

    setReferrer('android-app://com.google.android.gm/')
    expect(getAppClient()).toBe('web')
  })

  it('is the Android app when the app opened the page, and stays so once the referrer is gone', () => {
    setReferrer('android-app://com.flashcardsage.app/')
    expect(getAppClient()).toBe('android')

    // As after signing in, which comes back from Google.
    setReferrer('https://accounts.google.com/')
    expect(getAppClient()).toBe('android')
  })

  it("is still the Android app when storage can't be used", () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage is off')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage is off')
    })

    expect(getAppClient()).toBe('web')

    setReferrer('android-app://com.flashcardsage.app/')
    expect(getAppClient()).toBe('android')
  })
})

describe('apiFetch', () => {
  function sentClient() {
    return new Headers(
      (vi.mocked(fetch).mock.calls.at(-1)?.[1] as RequestInit).headers,
    ).get(appClientHeader)
  }

  it('tells the API which client the request is from', async () => {
    mockApi({ 'GET /me': {} })

    await apiFetch(api('/me'))
    expect(sentClient()).toBe('web')

    setReferrer('android-app://com.flashcardsage.app/')
    await apiFetch(api('/me'))
    expect(sentClient()).toBe('android')
  })
})
