import { ResponseError } from '../api/client'
import { sendPracticeResults } from '../api/practice'
import type { PracticeResultToSync } from '../api/practice'
import { getSession, sessionSubject } from '../auth/session'
import { createStore } from '../lib/store'
import { trackException } from '../telemetry'
import { readStoredPack, refreshPack } from './pack'
import { pendingCount, readQueue, removeResults } from './queue'

// Saves the answers given in practice (see queue) to the API, for the signed-in user.

// How many answers are waiting to be saved, and whether the last try to save them failed with the API reachable.
export type SyncStatus = { pending: number; failed: boolean }

export const syncStatus = createStore<SyncStatus>({ pending: 0, failed: false })

export function useSyncStatus() {
  return syncStatus.use()
}

function setStatus(pending: number, failed: boolean) {
  const current = syncStatus.get()
  if (current.pending !== pending || current.failed !== failed) {
    syncStatus.set({ pending, failed })
  }
}

// The most answers sent in one request. The API takes up to 500.
const batchSize = 100

// The sync in progress, which another call waits for rather than sending the same answers again.
let running: Promise<void> | null = null

// Sends the signed-in user's answers to the API, oldest first, in batches, until none are left or one can't be saved.
// It never throws: an answer that isn't saved stays on the device for the next time.
export function syncPracticeResults(): Promise<void> {
  running ??= sync().finally(() => {
    running = null
  })
  return running
}

async function sync() {
  const session = getSession()
  if (session === null) {
    return
  }
  const subject = sessionSubject(session)
  let failed = syncStatus.get().failed
  let refreshNeeded = false
  setStatus(pendingCount(subject), failed)

  // Stops once there's nothing to send, the user has signed out, or the API can't be reached (the browser knows it's
  // offline, so the 'online' event sends them).
  while (getSession() === session && navigator.onLine) {
    const batch = readQueue(subject).slice(0, batchSize)
    if (batch.length === 0) {
      if (!refreshNeeded) {
        break
      }
      // The scores have changed, so the pack is loaded again. Answers given meanwhile are sent next time round.
      refreshNeeded = false
      try {
        await refreshPack(subject)
      } catch (error) {
        if (!(error instanceof TypeError)) {
          trackException(error, { operation: 'practicePack' })
        }
      }
      continue
    }

    const outcome = await sendBatch(subject, batch)
    failed = outcome === 'failed' || (outcome === 'waiting' && failed)
    refreshNeeded ||= outcome === 'accepted'
    if (getSession() === session) {
      setStatus(pendingCount(subject), failed)
    }
    if (outcome === 'waiting' || outcome === 'failed') {
      break
    }
  }
}

// Sends the answers, and says how it went: accepted when the API recorded any, saved when it already had them all (or
// their cards are gone), dropped when it won't ever take them, waiting when it can't be reached or the sign-in has
// expired, and failed for anything else.
async function sendBatch(
  subject: string,
  batch: PracticeResultToSync[],
): Promise<'accepted' | 'saved' | 'dropped' | 'waiting' | 'failed'> {
  const ids = batch.map((result) => result.id)
  try {
    const { accepted } = await sendPracticeResults(batch)
    removeResults(subject, ids)
    return accepted > 0 ? 'accepted' : 'saved'
  } catch (error) {
    // The API can't be reached, or the sign-in has expired and apiFetch has signed the user out. The answers wait
    // until the API can be reached, or the user signs in again.
    if (
      error instanceof TypeError ||
      (error instanceof ResponseError && error.status === 401)
    ) {
      return 'waiting'
    }
    trackException(error, { operation: 'syncPracticeResults' })
    // The API won't ever take these answers, so they're dropped rather than block the ones after them.
    if (error instanceof ResponseError && error.status === 400) {
      removeResults(subject, ids)
      return 'dropped'
    }
    return 'failed'
  }
}

let started = false

function onOnline() {
  void syncPracticeResults()
}

// Starts saving the signed-in user's answers: now, and whenever the browser comes back online. When the user has no
// pack on the device yet, it's loaded too, so they can practice offline later even if they haven't opened practice.
// Calling it again does nothing until stopPracticeSync.
export function startPracticeSync() {
  if (started) {
    return
  }
  started = true
  window.addEventListener('online', onOnline)
  void syncPracticeResults()

  const session = getSession()
  if (session !== null && navigator.onLine) {
    const subject = sessionSubject(session)
    if (readStoredPack(subject) === null) {
      refreshPack(subject).catch((error: unknown) => {
        if (!(error instanceof TypeError)) {
          trackException(error, { operation: 'practicePack' })
        }
      })
    }
  }
}

// Stops saving answers, such as when the user signs out. Their answers stay on the device for when they're back.
export function stopPracticeSync() {
  if (!started) {
    return
  }
  started = false
  window.removeEventListener('online', onOnline)
  setStatus(0, false)
}
