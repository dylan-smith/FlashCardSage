import { duolingoGroups } from '../duolingo/duolingoCards'
import { duolingoBookmarkletHref } from '../duolingo/sendToFlashCardSage'
import { groupWords } from '../preply/groupWords'
import { bookmarkletHref } from '../preply/sendToFlashCardSage'

// A word or phrase from a website the user learns on, as the import page keeps it whichever site it came from: its
// Spanish, and whatever English the site has for it, which can be none.
export type SourceWord = {
  spanish: string
  english: string[]
}

// The words for one card, made from one or more of a site's words, and how many of them went into it.
export type WordGroup = {
  spanish: string[]
  english: string[]
  wordCount: number
}

export type WordSourceId = 'preply' | 'duolingo'

// A website the user's words can be brought in from with a "Send to FlashCardSage" bookmarklet. Each has a tab on the
// Import cards page (/import?from=<id>), which the bookmarklet opens, and a deck named after it that the cards go in.
export type WordSource = {
  id: WordSourceId
  // The site's name, which names its tab, its deck and its telemetry events.
  name: string
  // Where the bookmarklet runs, and so where its messages come from.
  origin: string
  // The page the user clicks the bookmarklet on, and what the site calls the words there.
  wordsUrl: string
  wordsName: string
  // The bookmark's address, which runs the bookmarklet for this FlashCardSage.
  bookmarkletHref: (appOrigin: string) => string
  // The site's words as cards.
  toGroups: (words: SourceWord[]) => WordGroup[]
}

export const preplySource: WordSource = {
  id: 'preply',
  name: 'Preply',
  origin: 'https://preply.com',
  wordsUrl: 'https://preply.com/en/practice/vocab-bank?subject=spanish',
  wordsName: 'vocabulary',
  bookmarkletHref,
  toGroups: groupWords,
}

export const duolingoSource: WordSource = {
  id: 'duolingo',
  name: 'Duolingo',
  origin: 'https://www.duolingo.com',
  wordsUrl: 'https://www.duolingo.com/practice-hub/words',
  wordsName: 'word list',
  bookmarkletHref: duolingoBookmarkletHref,
  toGroups: duolingoGroups,
}

// In the order of their tabs.
export const wordSources = [preplySource, duolingoSource]

// The source with this id, such as the URL's from parameter, if it's one.
export function wordSourceFrom(id: string | null): WordSource | null {
  return wordSources.find((source) => source.id === id) ?? null
}
