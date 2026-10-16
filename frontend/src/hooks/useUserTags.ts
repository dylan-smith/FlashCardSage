import { useEffect, useState } from 'react'
import type { FlashCard, Tag } from '../api/flashCards'
import { byName } from '../lib/text'
import { listTags } from '../api/tags'
import { trackException } from '../telemetry'

// The user's tags, for a card form to offer and suggest, and a way to add the tags a saved card came back with, since
// the API makes tags for new names. They're only needed to change a card's, so a list of cards still works if they
// don't load.
export function useUserTags() {
  const [tags, setTags] = useState<Tag[]>([])

  useEffect(() => {
    let cancelled = false
    listTags()
      .then((loaded) => {
        if (!cancelled) {
          setTags(loaded)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trackException(error, { operation: 'loadTags' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  function addNewTags(cards: FlashCard[]) {
    setTags((current) => {
      const added = cards
        .flatMap((card) => card.tags)
        .filter(
          (tag, index, all) =>
            !current.some((item) => item.id === tag.id) &&
            all.findIndex((item) => item.id === tag.id) === index,
        )
      return added.length === 0 ? current : [...current, ...added].sort(byName)
    })
  }

  return [tags, addNewTags] as const
}
