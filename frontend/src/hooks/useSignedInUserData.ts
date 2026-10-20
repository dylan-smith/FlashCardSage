import { useEffect } from 'react'
import { sessionSubject } from '../auth/session'
import type { Session } from '../auth/session'
import { startPracticeSync, stopPracticeSync } from '../practice/sync'
import { clearCounts, refreshCounts } from '../state/counts'
import { loadPreferences, setPreferences } from './usePreferences'

// Loads the signed-in user's preferences and counts and starts saving their practice answers, and forgets them when
// they sign out, so the next user's are loaded in their place.
export function useSignedInUserData(session: Session | null) {
  const subject = session === null ? null : sessionSubject(session)
  useEffect(() => {
    if (subject === null) {
      return
    }
    const controller = new AbortController()
    loadPreferences(subject, controller.signal)
    refreshCounts()
    startPracticeSync()
    return () => {
      controller.abort()
      setPreferences(null)
      clearCounts()
      stopPracticeSync()
    }
  }, [subject])
}
