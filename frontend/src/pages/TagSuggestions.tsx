import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import type { Tag } from '../api/flashCards'
import { listNewTagSuggestions } from '../api/tagSuggestions'
import { useCollapsed } from '../hooks/useCollapsed'
import { trackException } from '../telemetry'
import { CardActionButton } from './CardActionButton'
import { TagRenameForm } from './FlashCardTags'
import { SuggestionsHeading } from './SuggestionsHeading'

type Suggestion = { key: number; name: string }

type SuggestionsState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed' }
  | { status: 'ready'; suggestions: Suggestion[] }

// Kept in localStorage so the section stays collapsed across reloads once the user collapses it.
export const tagSuggestionsCollapsedKey =
  'flashcardsage.tagSuggestionsCollapsed'

// A handful of new tags suggested from the user's tags and cards, each with a button that adds it and one that changes
// its name first, like the suggested cards on the cards page. The section isn't shown when suggestions aren't
// available, and a suggestion the user has since made a tag for is left out.
export function TagSuggestions({
  tags,
  onAdd,
}: {
  tags: Tag[]
  // Makes the tag, resolving to whether it was saved.
  onAdd: (name: string) => Promise<boolean>
}) {
  const [state, setState] = useState<SuggestionsState>({ status: 'loading' })
  // Bumped to ask for a fresh handful.
  const [request, setRequest] = useState(0)
  // The key of the suggestion being added, so its button can wait for the API.
  const [adding, setAdding] = useState<number | null>(null)
  // The suggestion being changed and its name as typed so far.
  const [editing, setEditing] = useState<Suggestion | null>(null)
  const [collapsed, toggle] = useCollapsed(tagSuggestionsCollapsedKey)
  // Each suggestion gets a key of its own, since the user can change its name.
  const nextKey = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    listNewTagSuggestions(controller.signal)
      .then((names) => {
        setState(
          names === null
            ? { status: 'unavailable' }
            : {
                status: 'ready',
                suggestions: names.map((name) => ({
                  key: nextKey.current++,
                  name,
                })),
              },
        )
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          trackException(error, { operation: 'suggestTags' })
          setState({ status: 'failed' })
        }
      })
    return () => {
      controller.abort()
    }
  }, [request])

  function refresh() {
    setEditing(null)
    setState({ status: 'loading' })
    setRequest((current) => current + 1)
  }

  async function add(key: number, name: string) {
    setAdding(key)
    try {
      if (await onAdd(name.trim())) {
        setEditing(null)
        setState((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                suggestions: current.suggestions.filter(
                  (item) => item.key !== key,
                ),
              }
            : current,
        )
      }
    } finally {
      setAdding(null)
    }
  }

  function saveEdit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editing !== null) {
      void add(editing.key, editing.name)
    }
  }

  if (state.status === 'unavailable') {
    return null
  }

  const visible =
    state.status === 'ready'
      ? state.suggestions.filter(
          (suggestion) =>
            !tags.some(
              (tag) =>
                tag.name.localeCompare(suggestion.name, undefined, {
                  sensitivity: 'accent',
                }) === 0,
            ),
        )
      : []

  return (
    <Paper component="section" elevation={2} sx={{ p: 3 }}>
      <SuggestionsHeading
        title="Suggested tags"
        collapsed={collapsed}
        controls="suggested-tags-content"
        onToggle={toggle}
      />
      <Collapse in={!collapsed} id="suggested-tags-content" unmountOnExit>
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          New tags that go with your cards.
        </Typography>
        {state.status === 'loading' ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading suggestions" />
          </Box>
        ) : state.status === 'failed' ? (
          <Typography color="text.secondary">
            Unable to suggest tags right now.
          </Typography>
        ) : visible.length === 0 ? (
          <Typography color="text.secondary">
            No suggestions right now.
          </Typography>
        ) : (
          <List disablePadding aria-label="Suggested tags">
            {visible.map((suggestion) =>
              editing?.key === suggestion.key ? (
                <ListItem
                  key={suggestion.key}
                  divider
                  disablePadding
                  sx={{ pb: 1 }}
                >
                  <TagRenameForm
                    name={editing.name}
                    busy={adding !== null}
                    onChange={(name) =>
                      setEditing({ key: suggestion.key, name })
                    }
                    onCancel={() => setEditing(null)}
                    onSave={saveEdit}
                  />
                </ListItem>
              ) : (
                <ListItem
                  key={suggestion.key}
                  divider
                  disablePadding
                  sx={{ py: 1, gap: 1 }}
                >
                  <ListItemText
                    primary={suggestion.name}
                    sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                  />
                  <Box sx={{ display: 'flex', flexShrink: 0 }}>
                    <CardActionButton
                      icon="add"
                      text="Add"
                      label={`Add tag "${suggestion.name}"`}
                      disabled={adding !== null || editing !== null}
                      busyText={
                        adding === suggestion.key ? 'Adding…' : undefined
                      }
                      onClick={() => void add(suggestion.key, suggestion.name)}
                    />
                    <CardActionButton
                      icon="edit"
                      text="Edit"
                      label={`Edit tag "${suggestion.name}"`}
                      disabled={adding !== null}
                      onClick={() => setEditing(suggestion)}
                    />
                  </Box>
                </ListItem>
              ),
            )}
          </List>
        )}
        <Button
          type="button"
          size="small"
          disabled={
            state.status === 'loading' || adding !== null || editing !== null
          }
          onClick={refresh}
          sx={{ mt: 1 }}
        >
          {state.status === 'failed' ? 'Try again' : 'More suggestions'}
        </Button>
      </Collapse>
    </Paper>
  )
}
