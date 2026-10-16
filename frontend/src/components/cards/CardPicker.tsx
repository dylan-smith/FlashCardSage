import { useState } from 'react'
import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Pagination from '@mui/material/Pagination'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { FlashCard, Tag } from '../../api/flashCards'
import { byName } from '../../lib/text'
import { AnimatedList, AnimatedListItem } from '../common/AnimatedList'
import { EmptyText } from '../common/EmptyText'
import { cardCount } from '../../lib/cardCount'
import { matchesSearch } from '../../lib/cardSearch'
import { FlashCardRow } from './FlashCardRow'
import { TagFilter } from './FlashCardTags'

// How many cards a page of the list shows. A deck can hold hundreds, and drawing them all at once is slow.
export const cardPageSize = 50

// The tags on any of the cards, in name order.
function tagsOf(cards: FlashCard[]) {
  const tags = new Map<number, Tag>()
  for (const tag of cards.flatMap((card) => card.tags)) {
    tags.set(tag.id, tag)
  }
  return [...tags.values()].sort(byName)
}

// How many of the cards have each tag, as the tag chips show.
function countTags(cards: FlashCard[]) {
  const counts = new Map<number, number>()
  for (const tag of cards.flatMap((card) => card.tags)) {
    counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1)
  }
  return counts
}

// A list of cards to pick some of and do something with, such as add them to a deck. It can be searched and
// narrowed to a tag, and shows a page of cards at a time. Pick all picks every card that matches, on every page,
// so all the cards with a tag can be picked at once.
export function CardPicker({
  cards,
  tags = tagsOf(cards),
  emptyMessage,
  tagEmptyMessage = 'No cards match.',
  actionLabel,
  busy = false,
  onApply,
  pickedActions,
  rowActions,
  edit,
  tagId: shownTagId,
  onTagChange,
  pageSize = cardPageSize,
  pageList = false,
}: {
  cards: FlashCard[]
  // The tags to narrow the list to, which are the cards' own unless the user's are given, so a tag with no cards
  // still shows.
  tags?: Tag[]
  emptyMessage: string
  // What the list says when none of the cards have the tag picked.
  tagEmptyMessage?: string
  // What the button does with the picked cards, given how many there are (such as "2 cards", or just "cards" when
  // none are picked), as in "Remove 2 cards from deck". Without it (and onApply), there's no such button.
  actionLabel?: (cards: string) => string
  busy?: boolean
  // Resolves to whether it worked, so the cards stay picked when it didn't.
  onApply?: (ids: number[]) => Promise<boolean>
  // More buttons for the picked cards, shown after the main one, such as Delete, with a way to clear the picks once
  // they've done their job. A picked card that leaves the list stops counting as picked, so they needn't clear them
  // for that.
  pickedActions?: (ids: number[], clearPicks: () => void) => ReactNode
  // Buttons for a single card, shown at the end of its row, such as Delete.
  rowActions?: (card: FlashCard) => ReactNode
  // The card being edited, if one is, and the form shown in its row's place.
  edit?: { id: number; form: ReactNode }
  // The id of the tag whose cards are shown (null for every card) and what's told when another is picked, for a page
  // that keeps it itself, such as in the URL. Without it, the list keeps it.
  tagId?: number | null
  onTagChange?: (tagId: number | null) => void
  pageSize?: number
  // Laid out as the cards page's list, which is the page's main one: bigger tag chips, the cards straight under the
  // Pick all bar, and no bar while no card matches.
  pageList?: boolean
}) {
  const [search, setSearch] = useState('')
  const [ownTagId, setOwnTagId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const tagCounts = countTags(cards)
  // The picked tag may have gone with the last of its cards.
  const tagId = shownTagId === undefined ? ownTagId : shownTagId
  const activeTag = tags.find((tag) => tag.id === tagId) ?? null
  const tagCards =
    activeTag === null
      ? cards
      : cards.filter((card) => card.tags.some((tag) => tag.id === activeTag.id))
  const matching = tagCards.filter((card) => matchesSearch(card, search))
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  // Worked out only when there are pages, so a list without them (an endless page size) shows every card.
  const first = pageCount === 1 ? 0 : (currentPage - 1) * pageSize
  const shown =
    pageCount === 1 ? matching : matching.slice(first, first + pageSize)
  // Only the picked cards that still match count, so a card that left the list (or never matched the search) is
  // never acted on.
  const picked = matching
    .filter((card) => selected.has(card.id))
    .map((card) => card.id)
  const allPicked = matching.length > 0 && picked.length === matching.length

  // A new search or tag starts again from the first page with nothing picked.
  function changeFilter(change: () => void) {
    change()
    setPage(1)
    setSelected(new Set())
  }

  function pickTag(tag: Tag | null) {
    changeFilter(() => {
      setOwnTagId(tag?.id ?? null)
      onTagChange?.(tag?.id ?? null)
    })
  }

  function toggle(cardId: number) {
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(cardId)) {
        next.add(cardId)
      }
      return next
    })
  }

  function clearPicks() {
    setSelected(new Set())
  }

  async function apply() {
    if (onApply && (await onApply(picked))) {
      clearPicks()
    }
  }

  // With no cards there's nothing to search or pick, though the user's tags still show when they're given.
  if (cards.length === 0 && tags.length === 0) {
    return <EmptyText>{emptyMessage}</EmptyText>
  }

  return (
    <Stack spacing={pageList ? 0 : 2}>
      {cards.length > 0 && (
        <TextField
          label="Search"
          type="search"
          size="small"
          fullWidth
          value={search}
          onChange={(event) =>
            changeFilter(() => setSearch(event.target.value))
          }
          sx={{ mb: 2 }}
        />
      )}
      {tags.length > 0 && (
        <TagFilter
          tags={tags}
          counts={tagCounts}
          total={cards.length}
          selected={activeTag}
          onSelect={pickTag}
          size={pageList ? undefined : 'small'}
        />
      )}
      {cards.length === 0 ? (
        <EmptyText>{emptyMessage}</EmptyText>
      ) : (
        <>
          {!(pageList && matching.length === 0) && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
              }}
            >
              <FormControlLabel
                label={`Pick all ${matching.length}`}
                disabled={matching.length === 0}
                control={
                  <Checkbox
                    checked={allPicked}
                    indeterminate={picked.length > 0 && !allPicked}
                    onChange={() =>
                      setSelected(
                        new Set(
                          allPicked ? [] : matching.map((card) => card.id),
                        ),
                      )
                    }
                  />
                }
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {actionLabel && onApply && (
                  <Button
                    type="button"
                    variant="contained"
                    disabled={busy || picked.length === 0}
                    onClick={() => void apply()}
                  >
                    {actionLabel(
                      picked.length === 0 ? 'cards' : cardCount(picked.length),
                    )}
                  </Button>
                )}
                {pickedActions?.(picked, clearPicks)}
              </Box>
            </Box>
          )}
          {matching.length === 0 ? (
            <EmptyText>
              {tagCards.length === 0 ? tagEmptyMessage : 'No cards match.'}
            </EmptyText>
          ) : (
            <AnimatedList
              // Keyed on the page and filters, so changing them swaps the cards at once.
              key={`${currentPage}|${activeTag?.id ?? 'all'}|${search}`}
              disablePadding
            >
              {shown.map((card) =>
                edit?.id === card.id ? (
                  <AnimatedListItem key={`${card.id}-edit`}>
                    {edit.form}
                  </AnimatedListItem>
                ) : (
                  <AnimatedListItem key={card.id}>
                    <FlashCardRow
                      card={card}
                      picked={selected.has(card.id)}
                      onPick={() => toggle(card.id)}
                      actions={rowActions?.(card)}
                    />
                  </AnimatedListItem>
                ),
              )}
            </AnimatedList>
          )}
          {pageCount > 1 && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {first + 1}–{first + shown.length} of {matching.length}
              </Typography>
              <Pagination
                count={pageCount}
                page={currentPage}
                size="small"
                onChange={(_event, value) => setPage(value)}
              />
            </Box>
          )}
        </>
      )}
    </Stack>
  )
}
