import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { listCardSuggestions } from '../../api/cardSuggestions'
import { formatWords } from '../../api/flashCards'
import type { FlashCardWords, Tag } from '../../api/flashCards'
import { sameText } from '../../lib/text'
import { useCollapsed } from '../../hooks/useCollapsed'
import { trackException } from '../../telemetry'
import { AnimatedList, AnimatedListItem } from '../common/AnimatedList'
import { CardActionButton } from './CardActionButton'
import { useCandidateEditing } from '../../hooks/useCandidateEditing'
import { asCard } from '../../lib/candidates'
import type { Candidate } from '../../lib/candidates'
import { FlashCardEditForm } from './FlashCardForm'
import { FlashCardRow } from './FlashCardRow'
import { SuggestionsHeading } from './SuggestionsHeading'

type SuggestionsState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed' }
  | { status: 'ready'; suggestions: Candidate[] }

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
  const [collapsed, toggle] = useCollapsed(suggestionsCollapsedKey)
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
      <SuggestionsHeading
        title="Suggested cards"
        collapsed={collapsed}
        controls="suggested-cards-content"
        onToggle={toggle}
      />
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
          <AnimatedList disablePadding aria-label="Suggested cards">
            {visible.map((suggestion) => {
              if (editing?.key === suggestion.key) {
                return (
                  <AnimatedListItem key={`${suggestion.key}-edit`}>
                    <FlashCardEditForm
                      edit={editing}
                      tags={tags}
                      picture={editPicture}
                      busy={adding !== null}
                      onChange={changeEdit}
                      onCancel={cancelEdit}
                      onSave={saveEdit}
                    />
                  </AnimatedListItem>
                )
              }
              const spanish = formatWords(suggestion.spanish)
              return (
                <AnimatedListItem key={suggestion.key}>
                  <FlashCardRow
                    card={asCard(suggestion)}
                    actions={
                      <>
                        <CardActionButton
                          icon="add"
                          text="Add"
                          label={`Add "${spanish}"`}
                          disabled={adding !== null || editing !== null}
                          busyText={
                            adding === suggestion.key ? 'Adding…' : undefined
                          }
                          onClick={() => void add(suggestion)}
                        />
                        <CardActionButton
                          icon="edit"
                          text="Edit"
                          label={`Edit "${spanish}"`}
                          disabled={adding !== null}
                          onClick={() => startEditing(suggestion)}
                        />
                      </>
                    }
                  />
                </AnimatedListItem>
              )
            })}
          </AnimatedList>
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
