import { maxWordsPerSide } from '../api/flashCards'
import type { SourceWord, WordGroup } from '../wordSources/wordSources'

// Duolingo's words as cards, one for each word, with the English Duolingo has for it. Duolingo gives a word every
// meaning it has ("a" has fifteen), and many words share one, but a user can't have two cards with the same English
// word, so a word that's already on an earlier card is left off the later ones: "para" keeps "in order to" but not
// "for", which "a" has. A card has at most maxWordsPerSide words on each side, so a word with more English is left
// with the first of it, and the rest stay for other words. A word Duolingo has no English for, or whose English is all
// on earlier cards, can't be a card. Duolingo lists each word once, but one that comes again is one card.
export function duolingoGroups(words: SourceWord[]): WordGroup[] {
  const bySpanish = new Map<string, { word: SourceWord; wordCount: number }>()
  for (const word of words) {
    const key = word.spanish.toLowerCase()
    const seen = bySpanish.get(key)
    if (seen === undefined) {
      bySpanish.set(key, {
        word: { spanish: word.spanish, english: [...word.english] },
        wordCount: 1,
      })
    } else {
      seen.word.english.push(...word.english)
      seen.wordCount++
    }
  }

  const used = new Set<string>()
  const groups: WordGroup[] = []
  for (const { word, wordCount } of bySpanish.values()) {
    const english: string[] = []
    for (const text of word.english) {
      if (english.length === maxWordsPerSide) {
        break
      }
      const lower = text.toLowerCase()
      if (!used.has(lower)) {
        used.add(lower)
        english.push(text)
      }
    }
    if (english.length > 0) {
      groups.push({ spanish: [word.spanish], english, wordCount })
    }
  }
  return groups
}
