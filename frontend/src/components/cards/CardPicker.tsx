import { useState } from 'react'
import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Pagination from '@mui/material/Pagination'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { FlashCard, Tag } from '../../api/flashCards'
import { AnimatedList, AnimatedListItem } from '../common/AnimatedList'
import { cardCount } from '../../lib/cardCount'
import { matchesSearch } from '../../lib/cardSearch'
import { FlashCardRow } from './FlashCardRow'

// How many cards a page of the list shows. A deck can hold hundreds, and drawing them all at once is slow.
export const cardPageSize = 50

// The tags on any of the cards, in name order.
function tagsOf(cards: FlashCard[]) {
  const tags = new Map<number, Tag>()
  for (const tag of cards.flatMap((card) => card.tags)) {
    tags.set(tag.id, tag)
  }
  return [...tags.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

// A list of cards to pick some of and do something with, such as add them to a deck. It can be searched and
// narrowed to a tag, and shows a page of cards at a time. Pick all picks every card that matches, on every page,
// so all the cards with a tag can be picked at once.
export function CardPicker({
  cards,
  emptyMessage,
  actionLabel,
  busy,
  onApply,
  pickedActions,
  rowActions,
  edit,
}: {
  cards: FlashCard[]
  emptyMessage: string
  // What the button does with the picked cards, given how many there are (such as "2 cards", or just "cards" when
  // none are picked), as in "Remove 2 cards from deck".
  actionLabel: (cards: string) => string
  busy: boolean
  // Resolves to whether it worked, so the cards stay picked when it didn't.
  onApply: (ids: number[]) => Promise<boolean>
  // More buttons for the picked cards, shown after the main one, such as Delete. A picked card that leaves the list
  // stops counting as picked, so they needn't clear the picks.
  pickedActions?: (ids: number[]) => ReactNode
  // Buttons for a single card, shown at the end of its row, such as Delete.
  rowActions?: (card: FlashCard) => ReactNode
  // The card being edited, if one is, and the form shown in its row's place.
  edit?: { id: number; form: ReactNode }
}) {
  const [search, setSearch] = useState('')
  const [tagId, setTagId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const tags = tagsOf(cards)
  // How many of these cards have each tag, as the cards page's chips show.
  const tagCounts = new Map<number, number>()
  for (const tag of cards.flatMap((card) => card.tags)) {
    tagCounts.set(tag.id, (tagCounts.get(tag.id) ?? 0) + 1)
  }
  // The picked tag may have gone with the last of its cards.
  const activeTagId = tags.some((tag) => tag.id === tagId) ? tagId : null
  const matching = cards.filter(
    (card) =>
      (activeTagId === null ||
        card.tags.some((tag) => tag.id === activeTagId)) &&
      matchesSearch(card, search),
  )
  const pageCount = Math.max(1, Math.ceil(matching.length / cardPageSize))
  const currentPage = Math.min(page, pageCount)
  const shown = matching.slice(
    (currentPage - 1) * cardPageSize,
    currentPage * cardPageSize,
  )
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

  function toggle(cardId: number) {
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(cardId)) {
        next.add(cardId)
      }
      return next
    })
  }

  async function apply() {
    if (await onApply(picked)) {
      setSelected(new Set())
    }
  }

  return cards.length === 0 ? (
    <Typography color="text.secondary">{emptyMessage}</Typography>
  ) : (
    <Stack spacing={2}>
      <TextField
        label="Search"
        type="search"
        size="small"
        value={search}
        onChange={(event) => changeFilter(() => setSearch(event.target.value))}
      />
      {tags.length > 0 && (
        <Box
          role="group"
          aria-label="Show cards tagged"
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
        >
          {[null, ...tags].map((tag) => {
            const pressed = (tag?.id ?? null) === activeTagId
            return (
              <Chip
                key={tag?.id ?? 'all'}
                label={
                  tag === null
                    ? `All (${cards.length})`
                    : `${tag.name} (${tagCounts.get(tag.id) ?? 0})`
                }
                size="small"
                color={pressed ? 'primary' : 'default'}
                variant={pressed ? 'filled' : 'outlined'}
                aria-pressed={pressed}
                onClick={() => changeFilter(() => setTagId(tag?.id ?? null))}
              />
            )
          })}
        </Box>
      )}
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
                  new Set(allPicked ? [] : matching.map((card) => card.id)),
                )
              }
            />
          }
        />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
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
          {pickedActions?.(picked)}
        </Box>
      </Box>
      {matching.length === 0 ? (
        <Typography color="text.secondary">No cards match.</Typography>
      ) : (
        <AnimatedList
          // Keyed on the page and filters, so changing them swaps the cards at once.
          key={`${currentPage}|${activeTagId ?? 'all'}|${search}`}
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
            {(currentPage - 1) * cardPageSize + 1}–
            {(currentPage - 1) * cardPageSize + shown.length} of{' '}
            {matching.length}
          </Typography>
          <Pagination
            count={pageCount}
            page={currentPage}
            size="small"
            onChange={(_event, value) => setPage(value)}
          />
        </Box>
      )}
    </Stack>
  )
}
