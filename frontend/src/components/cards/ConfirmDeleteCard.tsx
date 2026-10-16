import { formatWords } from '../../api/flashCards'
import type { FlashCard } from '../../api/flashCards'
import { cardDeleteWarning } from '../../lib/cardDeleteWarning'
import { ConfirmDelete } from '../common/ConfirmDelete'

// Asks the user whether they mean to delete one card, whose Delete they clicked.
export function ConfirmDeleteCard({
  card,
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  card: FlashCard
  open: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ConfirmDelete
      open={open}
      onCancel={onCancel}
      title={`Delete "${formatWords(card.spanish)}"?`}
      busy={busy}
      onConfirm={onConfirm}
    >
      {cardDeleteWarning(1)}
    </ConfirmDelete>
  )
}
