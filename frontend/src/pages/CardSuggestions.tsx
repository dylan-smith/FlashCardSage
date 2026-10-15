import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import List from '@mui/material/List'
import Paper from '@mui/material/Paper'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'
import { listCardSuggestions } from '../api/cardSuggestions'
import { formatWords } from '../api/flashCards'
import type { FlashCardWords, Tag } from '../api/flashCards'
import { trackException } from '../telemetry'
import { CardIconButton } from './CardIconButton'
import { asCard, useCandidateEditing } from './candidates'
import type { Candidate } from './candidates'
import { FlashCardEditForm } from './FlashCardForm'
import { FlashCardRow } from './FlashCardRow'

type SuggestionsState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed' }
  | { status: 'ready'; suggestions: Candidate[] }

function sameText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

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

// Kept in localStorage so the section stays collapsed across reloads once the user collapses it.
export const suggestionsCollapsedKey = 'flashcardsage.suggestionsCollapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(suggestionsCollapsedKey) === 'true'
  } catch {
    return false
  }
}

function storeCollapsed(collapsed: boolean) {
  try {
    if (collapsed) {
      localStorage.setItem(suggestionsCollapsedKey, 'true')
    } else {
      localStorage.removeItem(suggestionsCollapsedKey)
    }
  } catch {
    // Storage can be unavailable, for example in a private window. The choice still lasts until the page reloads.
  }
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
  const [state, setState] = useState<SuggestionsState>({ status: 'loading' })
  // Bumped to ask for a fresh handful.
  const [request, setRequest] = useState(0)
  // The key of the suggestion being added, so its button can wait for the API.
  const [adding, setAdding] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  // Each suggestion gets a key of its own, since the user can change its words.
  const nextKey = useRef(0)

  const relatedToId = relatedTo?.id
  const tagName = tag?.name
  const tagId = tag?.id

  useEffect(() => {
    const controller = new AbortController()
    listCardSuggestions(
      { relatedTo: relatedToId, tag: tagId },
      controller.signal,
    )
      .then((suggestions) => {
        setState(
          suggestions === null
            ? { status: 'unavailable' }
            : {
                status: 'ready',
                suggestions: suggestions.map(({ spanish, english }) => ({
                  key: nextKey.current++,
                  spanish: [spanish],
                  english: [english],
                  tags: tagName === undefined ? [] : [tagName],
                  picture: null,
                })),
              },
        )
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          trackException(error, { operation: 'suggest' })
          setState({ status: 'failed' })
        }
      })
    return () => {
      controller.abort()
    }
  }, [request, relatedToId, tagId, tagName])

  const suggestions = state.status === 'ready' ? state.suggestions : []

  function changeSuggestions(update: (current: Candidate[]) => Candidate[]) {
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', suggestions: update(current.suggestions) }
        : current,
    )
  }

  const {
    editing,
    editPicture,
    startEditing,
    changeEdit,
    cancelEdit,
    saveEdit,
  } = useCandidateEditing(suggestions, changeSuggestions, onError)

  function refresh() {
    setState({ status: 'loading' })
    setRequest((current) => current + 1)
  }

  function toggle() {
    storeCollapsed(!collapsed)
    setCollapsed(!collapsed)
  }

  async function add(suggestion: Candidate) {
    setAdding(suggestion.key)
    try {
      if (await onAdd(suggestion)) {
        changeSuggestions((current) =>
          current.filter((item) => item.key !== suggestion.key),
        )
      }
    } finally {
      setAdding(null)
    }
  }

  if (state.status === 'unavailable') {
    return null
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
    <Paper component="section" elevation={2} sx={{ p: 3 }}>
      <Typography variant="h5" component="h2">
        <Button
          type="button"
          color="inherit"
          aria-expanded={!collapsed}
          aria-controls="suggested-cards-content"
          onClick={toggle}
          endIcon={
            <SvgIcon
              sx={{
                transform: collapsed ? 'rotate(-90deg)' : 'none',
                transition: 'transform 150ms',
              }}
            >
              <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
            </SvgIcon>
          }
          sx={{
            font: 'inherit',
            textTransform: 'none',
            ml: -1,
            px: 1,
            '& .MuiButton-endIcon > svg': { fontSize: 28 },
          }}
        >
          Suggested cards
        </Button>
      </Typography>
      <Collapse in={!collapsed} id="suggested-cards-content" unmountOnExit>
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          {describe(relatedTo, tag)}
        </Typography>
        {state.status === 'loading' ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading suggestions" />
          </Box>
        ) : state.status === 'failed' ? (
          <Typography color="text.secondary">
            Unable to suggest cards right now.
          </Typography>
        ) : visible.length === 0 ? (
          <Typography color="text.secondary">
            No suggestions right now.
          </Typography>
        ) : (
          <List disablePadding aria-label="Suggested cards">
            {visible.map((suggestion) => {
              if (editing?.key === suggestion.key) {
                return (
                  <FlashCardEditForm
                    key={suggestion.key}
                    edit={editing}
                    tags={tags}
                    picture={editPicture}
                    busy={adding !== null}
                    onChange={changeEdit}
                    onCancel={cancelEdit}
                    onSave={saveEdit}
                  />
                )
              }
              const spanish = formatWords(suggestion.spanish)
              return (
                <FlashCardRow
                  key={suggestion.key}
                  card={asCard(suggestion)}
                  actions={
                    <>
                      <CardIconButton
                        icon="add"
                        tooltip="Add"
                        label={`Add "${spanish}"`}
                        disabled={adding !== null || editing !== null}
                        busy={adding === suggestion.key}
                        onClick={() => void add(suggestion)}
                      />
                      <CardIconButton
                        icon="edit"
                        tooltip="Edit"
                        label={`Edit "${spanish}"`}
                        disabled={adding !== null}
                        onClick={() => startEditing(suggestion)}
                      />
                    </>
                  }
                />
              )
            })}
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
