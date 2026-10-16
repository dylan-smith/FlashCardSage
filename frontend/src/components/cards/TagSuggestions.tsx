import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import type { Tag } from '../../api/flashCards'
import { listNewTagSuggestions } from '../../api/tagSuggestions'
import { useCollapsed } from '../../hooks/useCollapsed'
import { trackException } from '../../telemetry'
import { AnimatedList, AnimatedListItem } from '../common/AnimatedList'
import { CardActionButton } from './CardActionButton'
import { SuggestionsHeading } from './SuggestionsHeading'

type SuggestionsState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed' }
  | { status: 'ready'; names: string[] }

// Kept in localStorage so the section stays collapsed across reloads once the user collapses it.
export const tagSuggestionsCollapsedKey =
  'flashcardsage.tagSuggestionsCollapsed'

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
  const [state, setState] = useState<SuggestionsState>({ status: 'loading' })
  // Bumped to ask for a fresh handful.
  const [request, setRequest] = useState(0)
  // The suggestion being added, so its button can wait for the API. The API sends each name once.
  const [adding, setAdding] = useState<string | null>(null)
  const [collapsed, toggle] = useCollapsed(tagSuggestionsCollapsedKey)

  useEffect(() => {
    const controller = new AbortController()
    listNewTagSuggestions(controller.signal)
      .then((names) => {
        setState(
          names === null
            ? { status: 'unavailable' }
            : { status: 'ready', names },
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
    setState({ status: 'loading' })
    setRequest((current) => current + 1)
  }

  async function add(name: string) {
    setAdding(name)
    try {
      if (await onAdd(name)) {
        setState((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                names: current.names.filter((item) => item !== name),
              }
            : current,
        )
      }
    } finally {
      setAdding(null)
    }
  }

  if (state.status === 'unavailable') {
    return null
  }

  const visible =
    state.status === 'ready'
      ? state.names.filter(
          (name) =>
            !tags.some(
              (tag) =>
                tag.name.localeCompare(name, undefined, {
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
        )}
        <Button
          type="button"
          size="small"
          disabled={state.status === 'loading' || adding !== null}
          onClick={refresh}
          sx={{ mt: 1 }}
        >
          {state.status === 'failed' ? 'Try again' : 'More suggestions'}
        </Button>
      </Collapse>
    </Paper>
  )
}
