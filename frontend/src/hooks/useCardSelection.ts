import { useSearchParams } from 'react-router'
import { listDecks } from '../api/decks'
import type { Deck } from '../api/decks'
import type { Tag } from '../api/flashCards'
import { listTags } from '../api/tags'
import { useLoad } from './useLoad'

// Which cards a page is about: every card, a deck's or a tag's.
export type CardSelectionKind = 'all' | 'deck' | 'tag'

// The user's decks and tags, to pick which cards a page is about.
export type CardSelectionChoices = { decks: Deck[]; tags: Tag[] }

// The deck or tag picked for practice or scores. It's in the URL, so the back button and a refresh keep it. One that
// doesn't exist (any more) picks every card.
export function useCardSelection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const deckParam = searchParams.get('deck')
  const tagParam = searchParams.get('tag')
  // Null until they've loaded.
  const { data: choices, failed: choicesFailed } = useLoad(
    async (): Promise<CardSelectionChoices | null> => {
      const [decks, tags] = await Promise.all([listDecks(), listTags()])
      return { decks, tags }
    },
    [],
    { operation: 'loadChoices', initial: null },
  )

  const deck =
    choices?.decks.find((item) => String(item.id) === deckParam) ?? null
  const tag =
    deck === null
      ? (choices?.tags.find((item) => String(item.id) === tagParam) ?? null)
      : null
  const kind: CardSelectionKind = deck ? 'deck' : tag ? 'tag' : 'all'
  const value = deck ? `deck-${deck.id}` : tag ? `tag-${tag.id}` : 'all'
  // A deck or tag in the URL can only be used once it's known to be the user's.
  const waiting =
    choices === null &&
    !choicesFailed &&
    (deckParam !== null || tagParam !== null)

  // Takes a picker value: "all", "deck-<id>" or "tag-<id>".
  function select(selected: string) {
    const [type, id] = selected.split('-')
    setSearchParams(
      type === 'deck' ? { deck: id } : type === 'tag' ? { tag: id } : {},
    )
  }

  return { choices, deck, tag, kind, value, waiting, select }
}
