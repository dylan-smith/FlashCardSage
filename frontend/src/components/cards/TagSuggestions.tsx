import { useState } from 'react'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import type { Tag } from '../../api/flashCards'
import { storageKeys } from '../../lib/storageKeys'
import { sameText } from '../../lib/text'
import { listNewTagSuggestions } from '../../api/tagSuggestions'
import { useSuggestions } from '../../hooks/useSuggestions'
import { AnimatedList, AnimatedListItem } from '../common/AnimatedList'
import { CardActionButton } from './CardActionButton'
import { SuggestionsPanel } from './SuggestionsPanel'

// A handful of new tags suggested from the user's tags and cards, each with a button that adds it, like the suggested
// cards on the cards page. A different name is typed in the New tag section instead. The section isn't shown when
// suggestions aren't available, and a suggestion the user has since made a tag for is left out.
export function TagSuggestions({
  tags,
  onAdd,
}: {
  tags: Tag[]
  // Makes the tag, resolving to whether it was saved.
  onAdd: (name: string) => Promise<boolean>
}) {
  const { state, refresh, update } = useSuggestions(
    (signal) => listNewTagSuggestions(signal),
    [],
    'suggestTags',
  )
  // The suggestion being added, so its button can wait for the API. The API sends each name once.
  const [adding, setAdding] = useState<string | null>(null)

  async function add(name: string) {
    setAdding(name)
    try {
      if (await onAdd(name)) {
        update((current) => current.filter((item) => item !== name))
      }
    } finally {
      setAdding(null)
    }
  }

  const visible =
    state.status === 'ready'
      ? state.suggestions.filter(
          (name) => !tags.some((tag) => sameText(tag.name, name)),
        )
      : []

  return (
    <SuggestionsPanel
      title="Suggested tags"
      contentId="suggested-tags-content"
      collapsedKey={storageKeys.tagSuggestionsCollapsed}
      description="New tags that go with your cards."
      state={state}
      failedText="Unable to suggest tags right now."
      empty={visible.length === 0}
      busy={adding !== null}
      onRefresh={refresh}
    >
      <AnimatedList disablePadding aria-label="Suggested tags">
        {visible.map((name) => (
          <AnimatedListItem key={name}>
            <ListItem
              component="div"
              divider
              disablePadding
              sx={{ py: 1, gap: 1 }}
            >
              <ListItemText
                primary={name}
                sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
              />
              <CardActionButton
                icon="add"
                text="Add"
                label={`Add tag "${name}"`}
                disabled={adding !== null}
                busyText={adding === name ? 'Adding…' : undefined}
                onClick={() => void add(name)}
              />
            </ListItem>
          </AnimatedListItem>
        ))}
      </AnimatedList>
    </SuggestionsPanel>
  )
}
