import type { Tag } from '../../api/flashCards'
import { formatWords } from '../../api/flashCards'
import type { CandidateEditor } from '../../hooks/useCandidateEditing'
import { asCard } from '../../lib/candidates'
import type { Adding, Candidate } from '../../lib/candidates'
import { AnimatedList, AnimatedListItem } from '../common/AnimatedList'
import { CardActionButton } from './CardActionButton'
import { FlashCardEditForm } from './FlashCardForm'
import { FlashCardRow } from './FlashCardRow'

// Cards to add, such as suggested ones or ones from a document, each shown like the user's cards with buttons that add
// it, change it first with the same form as the cards page (from editor), and, with onRemove, take it out of the list.
// The one being changed shows its form instead. listKey, when given, keys the list, so changing it (such as the
// search) swaps the cards at once.
export function CandidateList({
  label,
  listKey,
  candidates,
  editor,
  tags,
  adding,
  onAdd,
  onRemove,
}: {
  label: string
  listKey?: string
  candidates: Candidate[]
  editor: CandidateEditor
  // The user's tags, offered when a card is changed.
  tags: Tag[]
  adding: Adding
  onAdd: (candidate: Candidate) => void
  onRemove?: (candidate: Candidate) => void
}) {
  const {
    editing,
    editPicture,
    startEditing,
    changeEdit,
    cancelEdit,
    saveEdit,
  } = editor

  return (
    <AnimatedList key={listKey} disablePadding aria-label={label}>
      {candidates.map((candidate) => {
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
                    busyText={adding === candidate.key ? 'Adding…' : undefined}
                    onClick={() => onAdd(candidate)}
                  />
                  <CardActionButton
                    icon="edit"
                    text="Edit"
                    label={`Edit "${spanish}"`}
                    disabled={adding !== null}
                    onClick={() => startEditing(candidate)}
                  />
                  {onRemove && (
                    <CardActionButton
                      icon="remove"
                      text="Remove"
                      label={`Remove "${spanish}"`}
                      disabled={adding !== null}
                      onClick={() => onRemove(candidate)}
                    />
                  )}
                </>
              }
            />
          </AnimatedListItem>
        )
      })}
    </AnimatedList>
  )
}
