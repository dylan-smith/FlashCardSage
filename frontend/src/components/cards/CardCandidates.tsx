import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { putCardImage } from '../../api/cardImages'
import type { CardImage } from '../../api/cardImages'
import { ApiError, describeFetchError, formatWords } from '../../api/flashCards'
import type {
  FlashCard,
  FlashCardBatch,
  FlashCardFields,
  Tag,
} from '../../api/flashCards'
import { trackEvent, trackException } from '../../telemetry'
import { AnimatedList, AnimatedListItem } from '../common/AnimatedList'
import { CardActionButton } from './CardActionButton'
import { useCandidateEditing } from '../../hooks/useCandidateEditing'
import { asCard } from '../../lib/candidates'
import type { Candidate } from '../../lib/candidates'
import { matchesSearch } from '../../lib/cardSearch'
import { FlashCardEditForm } from './FlashCardForm'
import { FlashCardRow } from './FlashCardRow'

export type { Candidate } from '../../lib/candidates'

// What's being added: all the cards, or the one with this key.
export type Adding = 'all' | number | null

// Reports a failure, unless it's an error the API sent for the user to see, such as a 409 for a card the user already
// has, which is theirs to fix, not a failure.
function reportFailure(error: unknown, operation: string) {
  if (!(error instanceof ApiError)) {
    trackException(error, { operation })
  }
}

function sameText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

function picturesFailedMessage(failed: number) {
  return failed === 1
    ? "A card was added, but its picture couldn't be."
    : `${failed} cards were added, but their pictures couldn't be.`
}

// Cards for the user to look over, change (with the same form as the cards page) or remove, and then add one at a time
// or all at once, such as the ones scanned from a document or brought in from Preply. addOne and addAll save them,
// and onAddedOne and onAddedAll say what was added, once any pictures are on the cards. The list itself is the
// caller's, as are the tags offered, what's being added and any error, so it can show them with its own. A searchable
// list has a search box like the other card lists, and Add all adds just the cards that match, which onAddedAll is
// given.
export function CardCandidates({
  label,
  searchable = false,
  candidates,
  onCandidatesChange,
  tags,
  onTagsAdded,
  adding,
  onAddingChange,
  onError,
  addOne,
  addAll,
  onAddedOne,
  onAddedAll,
}: {
  label: string
  searchable?: boolean
  candidates: Candidate[]
  onCandidatesChange: (update: (candidates: Candidate[]) => Candidate[]) => void
  tags: Tag[]
  onTagsAdded: (cards: FlashCard[]) => void
  adding: Adding
  onAddingChange: (adding: Adding) => void
  onError: (message: string) => void
  addOne: (fields: FlashCardFields) => Promise<FlashCard>
  addAll: (fields: FlashCardFields[]) => Promise<FlashCardBatch>
  onAddedOne: (candidate: Candidate) => void
  onAddedAll: (result: FlashCardBatch, added: Candidate[]) => void
}) {
  const [search, setSearch] = useState('')
  const {
    editing,
    editPicture,
    startEditing,
    changeEdit,
    cancelEdit,
    saveEdit,
  } = useCandidateEditing(candidates, onCandidatesChange, onError)
  // The card being changed stays in the list whatever the search, so its form doesn't vanish.
  const shown = candidates.filter(
    (candidate) =>
      candidate.key === editing?.key || matchesSearch(candidate, search),
  )

  function remove(key: number) {
    onCandidatesChange((current) =>
      current.filter((candidate) => candidate.key !== key),
    )
  }

  // Puts each added card's picture on it. The cards are added whatever happens to the pictures, so it returns how
  // many couldn't be.
  async function addPictures(pictures: { id: number; picture: CardImage }[]) {
    let failed = 0
    for (const { id, picture } of pictures) {
      try {
        await putCardImage(id, picture)
        trackEvent('FlashCardImageAdded')
      } catch (error) {
        reportFailure(error, 'picture')
        failed++
      }
    }
    return failed
  }

  async function handleAddOne(candidate: Candidate) {
    onAddingChange(candidate.key)
    onError('')

    try {
      const card = await addOne({
        spanish: candidate.spanish,
        english: candidate.english,
        tags: candidate.tags,
      })
      onTagsAdded([card])
      const failed =
        candidate.picture === null
          ? 0
          : await addPictures([{ id: card.id, picture: candidate.picture }])
      if (failed > 0) {
        onError(picturesFailedMessage(failed))
      }
      onAddedOne(candidate)
    } catch (error) {
      reportFailure(error, 'add')
      onError(describeFetchError(error, 'Unable to add the card.'))
    } finally {
      onAddingChange(null)
    }
  }

  async function handleAddAll() {
    const toAdd = shown
    onAddingChange('all')
    onError('')

    try {
      const result = await addAll(
        toAdd.map(({ spanish, english, tags }) => ({
          spanish,
          english,
          tags,
        })),
      )
      onTagsAdded(result.cards)
      // The cards that were added come back without the ones left out, so each picture finds its card by its first
      // Spanish word, which no other card can have.
      const pictures = toAdd.flatMap(({ spanish, picture }) => {
        const card = result.cards.find((item) =>
          sameText(item.spanish[0] ?? '', spanish[0] ?? ''),
        )
        return card === undefined || picture === null
          ? []
          : [{ id: card.id, picture }]
      })
      const failed = await addPictures(pictures)
      if (failed > 0) {
        onError(picturesFailedMessage(failed))
      }
      onAddedAll(result, toAdd)
    } catch (error) {
      reportFailure(error, 'add')
      onError(describeFetchError(error, 'Unable to add the cards.'))
    } finally {
      onAddingChange(null)
    }
  }

  // Above and below the list, so a long list can be added from either end without scrolling past it.
  const addAllButton = (
    <Box>
      <Button
        type="button"
        variant="contained"
        disabled={adding !== null || editing !== null}
        onClick={() => void handleAddAll()}
      >
        {adding === 'all'
          ? 'Adding…'
          : shown.length === 1
            ? 'Add 1 card'
            : `Add all ${shown.length} cards`}
      </Button>
    </Box>
  )

  return (
    <>
      {searchable && (
        <TextField
          label="Search"
          type="search"
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      {shown.length === 0 ? (
        <Typography color="text.secondary">No cards match.</Typography>
      ) : (
        <>
          {addAllButton}
          {/* Keyed on the search, so changing it swaps the cards at once. */}
          <AnimatedList key={search} disablePadding aria-label={label}>
            {shown.map((candidate) => {
              if (editing?.key === candidate.key) {
                return (
                  <AnimatedListItem key={`${candidate.key}-edit`}>
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
              const spanish = formatWords(candidate.spanish)
              return (
                <AnimatedListItem key={candidate.key}>
                  <FlashCardRow
                    card={asCard(candidate)}
                    actions={
                      <>
                        <CardActionButton
                          icon="add"
                          text="Add"
                          label={`Add "${spanish}"`}
                          disabled={adding !== null || editing !== null}
                          busyText={
                            adding === candidate.key ? 'Adding…' : undefined
                          }
                          onClick={() => void handleAddOne(candidate)}
                        />
                        <CardActionButton
                          icon="edit"
                          text="Edit"
                          label={`Edit "${spanish}"`}
                          disabled={adding !== null}
                          onClick={() => startEditing(candidate)}
                        />
                        <CardActionButton
                          icon="remove"
                          text="Remove"
                          label={`Remove "${spanish}"`}
                          disabled={adding !== null}
                          onClick={() => remove(candidate.key)}
                        />
                      </>
                    }
                  />
                </AnimatedListItem>
              )
            })}
          </AnimatedList>
          {addAllButton}
        </>
      )}
    </>
  )
}
