import type { PracticeOutcome } from '../api/flashCards'
import type { PracticeResultToSync } from '../api/practice'
import { readJson, removeJson, writeJson } from '../lib/localJson'
import { storageKeys, userStorageKey } from '../lib/storageKeys'

// The answers the user gave in practice that the API doesn't have yet, oldest first, kept on the device for each user
// until they're saved (see sync).

const outcomes: unknown[] = ['GotIt', 'WasClose', 'Failed']

function queueKey(subject: string) {
  return userStorageKey(storageKeys.practiceQueue, subject)
}

function isResult(value: unknown): value is PracticeResultToSync {
  const result = value as Partial<PracticeResultToSync> | null
  return (
    typeof result === 'object' &&
    result !== null &&
    typeof result.id === 'string' &&
    typeof result.flashCardId === 'number' &&
    outcomes.includes(result.outcome) &&
    typeof result.practicedAt === 'string'
  )
}

function isQueue(value: unknown): value is PracticeResultToSync[] {
  return Array.isArray(value) && value.every(isResult)
}

// When the queue can't be written, the answers stay and are sent again, which the API ignores since it has their ids.
function writeQueue(subject: string, queue: PracticeResultToSync[]) {
  if (queue.length === 0) {
    removeJson(queueKey(subject))
  } else {
    writeJson(queueKey(subject), queue)
  }
}

export function readQueue(subject: string): PracticeResultToSync[] {
  return readJson(queueKey(subject), isQueue) ?? []
}

export function pendingCount(subject: string) {
  return readQueue(subject).length
}

// Keeps the answer, given at practicedAt, until it's saved, and returns it with the id it's saved under. Throws when
// it can't be kept, such as when storage is full, so the answer isn't lost without the user knowing.
export function enqueueResult(
  subject: string,
  flashCardId: number,
  outcome: PracticeOutcome,
  practicedAt: string,
): PracticeResultToSync {
  const result = { id: crypto.randomUUID(), flashCardId, outcome, practicedAt }
  if (!writeJson(queueKey(subject), [...readQueue(subject), result])) {
    throw new Error('The answer could not be kept on this device.')
  }
  return result
}

// Forgets the answers with these ids, once the API has them. Answers given since they were sent stay.
export function removeResults(subject: string, ids: string[]) {
  const removed = new Set(ids)
  writeQueue(
    subject,
    readQueue(subject).filter((result) => !removed.has(result.id)),
  )
}
