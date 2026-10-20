import type { Deck } from '../api/decks'
import type { PracticeSelection, Tag } from '../api/flashCards'
import { getPracticePack } from '../api/practice'
import type {
  PackCard,
  PracticePack,
  PracticeResultToSync,
} from '../api/practice'
import { currentPreferences } from '../hooks/usePreferences'
import { readJson, writeJson } from '../lib/localJson'
import { storageKeys, userStorageKey } from '../lib/storageKeys'
import { trackException } from '../telemetry'
import { cachePictures } from './pictures'
import { applyAnswer } from './score'

// The user's cards, decks and tags as the API last sent them (the pack), kept on the device for each user so practice
// works offline. What's practiced is always the last pack plus the answers not saved yet (see withPendingAnswers), so
// loading a new pack while the user practices can't lose or count an answer twice.

function packKey(subject: string) {
  return userStorageKey(storageKeys.practicePack, subject)
}

function isPack(value: unknown): value is PracticePack {
  const pack = value as Partial<PracticePack> | null
  return (
    typeof pack === 'object' &&
    pack !== null &&
    Array.isArray(pack.cards) &&
    Array.isArray(pack.decks) &&
    Array.isArray(pack.tags)
  )
}

export function readStoredPack(subject: string): PracticePack | null {
  return readJson(packKey(subject), isPack)
}

// Returns whether the pack was stored. When it can't be, such as when storage is full, practice still works online.
export function writeStoredPack(subject: string, pack: PracticePack) {
  return writeJson(packKey(subject), pack)
}

// Loads the pack from the API and keeps it, and keeps the cards' pictures too while the user has pictures on.
export async function refreshPack(subject: string, signal?: AbortSignal) {
  const pack = await getPracticePack(signal)
  writeStoredPack(subject, pack)
  if (currentPreferences()?.showPictures) {
    void cachePictures(pack)
  }
  return pack
}

// The pack to practice from: the API's when it can be reached, otherwise the one kept on the device. Null when there's
// none on the device and the API can't be reached. Throws when there's none on the device and the API sent an error.
export async function loadPracticePack(
  subject: string,
  signal?: AbortSignal,
): Promise<PracticePack | null> {
  if (!navigator.onLine) {
    return readStoredPack(subject)
  }
  try {
    return await refreshPack(subject, signal)
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    const stored = readStoredPack(subject)
    if (stored === null) {
      if (error instanceof TypeError) {
        return null
      }
      throw error
    }
    // A TypeError is the API not being reachable, which the stored pack is for.
    if (!(error instanceof TypeError)) {
      trackException(error, { operation: 'practicePack' })
    }
    return stored
  }
}

// The pack with the answers not saved yet applied to its cards, oldest first, as they will be once they're saved.
export function withPendingAnswers(
  pack: PracticePack,
  queue: PracticeResultToSync[],
): PracticePack {
  if (queue.length === 0) {
    return pack
  }
  const cards = new Map(pack.cards.map((card) => [card.id, card]))
  for (const result of queue) {
    const card = cards.get(result.flashCardId)
    if (card !== undefined) {
      cards.set(card.id, applyAnswer(card, result.outcome, result.practicedAt))
    }
  }
  return { ...pack, cards: [...cards.values()] }
}

// The selection's cards: a deck's, in the deck's order, a tag's, or all of them. None for a deck that's gone.
export function selectCards(
  pack: PracticePack,
  { deckId, tagId }: PracticeSelection,
): PackCard[] {
  if (deckId !== undefined) {
    const deck = pack.decks.find((item) => item.id === deckId)
    if (deck === undefined) {
      return []
    }
    const cards = new Map(pack.cards.map((card) => [card.id, card]))
    return deck.flashCardIds.flatMap((id) => cards.get(id) ?? [])
  }
  if (tagId !== undefined) {
    return pack.cards.filter((card) => card.tagIds.includes(tagId))
  }
  return pack.cards
}

// The user's decks and tags from the pack on the device, to pick what to practice when the API can't be reached, or
// null when there's no pack.
export function storedChoices(
  subject: string,
): { decks: Deck[]; tags: Tag[] } | null {
  const pack = readStoredPack(subject)
  return pack === null ? null : { decks: pack.decks, tags: pack.tags }
}
