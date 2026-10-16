import { maxWordsPerSide } from '../api/flashCards'
import type { SourceWord, WordGroup } from '../wordSources/wordSources'

export type { WordGroup } from '../wordSources/wordSources'

// Preply's words as cards. A user can't have two cards with the same Spanish or English, so Preply words that share
// either, such as tostado and tostada for "toasted", go on one card with all their words, in the order Preply has them.
// A word Preply has no English for can't be a card. A card has at most maxWordsPerSide words on each side, so in the
// rare group with more, the rest are left off.
export function groupWords(words: SourceWord[]): WordGroup[] {
  const usable = words.filter((word) => word.english.length > 0)

  // Each word starts in a group of its own, and words that share a Spanish or English word are joined.
  const parent = usable.map((_, index) => index)
  function root(index: number): number {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]]
      index = parent[index]
    }
    return index
  }
  function join(a: number, b: number) {
    const [first, second] = [root(a), root(b)].sort((x, y) => x - y)
    parent[second] = first
  }
  const firstWith = {
    spanish: new Map<string, number>(),
    english: new Map<string, number>(),
  }
  usable.forEach((word, index) => {
    for (const side of ['spanish', 'english'] as const) {
      for (const text of side === 'spanish' ? [word.spanish] : word.english) {
        const lower = text.toLowerCase()
        const earlier = firstWith[side].get(lower)
        if (earlier === undefined) {
          firstWith[side].set(lower, index)
        } else {
          join(earlier, index)
        }
      }
    }
  })

  // In the order each group's first word comes, each word once whatever its case.
  const groups = new Map<number, WordGroup>()
  usable.forEach((word, index) => {
    const group = groups.get(root(index)) ?? {
      spanish: [],
      english: [],
      wordCount: 0,
    }
    groups.set(root(index), group)
    group.wordCount++
    for (const side of ['spanish', 'english'] as const) {
      const words = group[side]
      for (const text of side === 'spanish' ? [word.spanish] : word.english) {
        if (
          words.length < maxWordsPerSide &&
          !words.some((item) => item.toLowerCase() === text.toLowerCase())
        ) {
          words.push(text)
        }
      }
    }
  })
  return [...groups.values()]
}
