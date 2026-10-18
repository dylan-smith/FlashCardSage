import type { FlashCard, Tag } from '../api/flashCards'
import { listTags } from '../api/tags'
import { withNewTags } from './useCardEditor'
import { useLoad } from './useLoad'

// The user's tags, for a card form to offer and suggest, and a way to add the tags a saved card came back with, since
// the API makes tags for new names. They're only needed to change a card's, so a list of cards still works if they
// don't load.
export function useUserTags() {
  const { data: tags, setData: setTags } = useLoad(() => listTags(), [], {
    operation: 'loadTags',
    initial: [] as Tag[],
  })

  function addNewTags(cards: FlashCard[]) {
    setTags((current) => cards.reduce(withNewTags, current))
  }

  return [tags, addNewTags] as const
}
