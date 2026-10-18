import { useRef, useState } from 'react'
import { listCardSuggestions } from '../../api/cardSuggestions'
import { formatWords } from '../../api/flashCards'
import type { FlashCardWords, Tag } from '../../api/flashCards'
import { storageKeys } from '../../lib/storageKeys'
import { sameText } from '../../lib/text'
import { useCandidateEditing } from '../../hooks/useCandidateEditing'
import { useSuggestions } from '../../hooks/useSuggestions'
import type { Candidate } from '../../lib/candidates'
import { CandidateList } from './CandidateList'
import { SuggestionsPanel } from './SuggestionsPanel'

// What the suggestions are for, under the heading.
function describe(relatedTo?: FlashCardWords, tag?: Tag) {
  if (relatedTo) {
    const kind = tag
      ? `New “${tag.name}” words and phrases`
      : 'New words and phrases'
    return `${kind} that go with “${formatWords(relatedTo.spanish)}”.`
  }
  return tag
    ? `New words and phrases for your “${tag.name}” cards.`
    : 'New words and phrases that go with your cards.'
}

// A handful of new cards suggested from the user's cards, each with a button that adds it and one that changes it
// first, with the same form as the cards page. The section isn't shown when suggestions aren't available, and a
// suggestion the user has since added a card for is left out. With relatedTo (e.g. a card just added), the suggestions
// are related to that card, and with tag (e.g. the one whose cards are shown), they go under that tag. Give it a key
// that changes with relatedTo and tag, so new suggestions load when they do.
export function CardSuggestions({
  cards,
  relatedTo,
  tag,
  tags,
  onAdd,
  onError,
}: {
  cards: FlashCardWords[]
  relatedTo?: FlashCardWords
  tag?: Tag
  // The user's tags, offered when a suggestion is changed.
  tags: Tag[]
  onAdd: (suggestion: Candidate) => Promise<boolean>
  onError: (message: string) => void
}) {
  // The key of the suggestion being added, so its button can wait for the API.
  const [adding, setAdding] = useState<number | null>(null)
  // Each suggestion gets a key of its own, since the user can change its words.
  const nextKey = useRef(0)

  const relatedToId = relatedTo?.id
  const tagName = tag?.name
  const tagId = tag?.id

  const { state, refresh, update } = useSuggestions(
    async (signal): Promise<Candidate[] | null> => {
      const suggestions = await listCardSuggestions(
        { relatedTo: relatedToId, tag: tagId },
        signal,
      )
      return suggestions === null
        ? null
        : suggestions.map(({ spanish, english }) => ({
            key: nextKey.current++,
            spanish: [spanish],
            english: [english],
            tags: tagName === undefined ? [] : [tagName],
            picture: null,
          }))
    },
    [relatedToId, tagId, tagName],
    'suggest',
  )
  const suggestions = state.status === 'ready' ? state.suggestions : []
  const editor = useCandidateEditing(suggestions, update, onError)

  async function add(suggestion: Candidate) {
    setAdding(suggestion.key)
    try {
      if (await onAdd(suggestion)) {
        update((current) =>
          current.filter((item) => item.key !== suggestion.key),
        )
      }
    } finally {
      setAdding(null)
    }
  }

  const visible = suggestions.filter(
    (suggestion) =>
      !cards.some(
        (card) =>
          card.spanish.some((word) =>
            suggestion.spanish.some((other) => sameText(word, other)),
          ) ||
          card.english.some((word) =>
            suggestion.english.some((other) => sameText(word, other)),
          ),
      ),
  )

  return (
    <SuggestionsPanel
      title="Suggested cards"
      contentId="suggested-cards-content"
      collapsedKey={storageKeys.suggestionsCollapsed}
      description={describe(relatedTo, tag)}
      state={state}
      failedText="Unable to suggest cards right now."
      empty={visible.length === 0}
      busy={adding !== null || editor.editing !== null}
      onRefresh={refresh}
    >
      <CandidateList
        label="Suggested cards"
        candidates={visible}
        editor={editor}
        tags={tags}
        adding={adding}
        onAdd={(suggestion) => void add(suggestion)}
      />
    </SuggestionsPanel>
  )
}
