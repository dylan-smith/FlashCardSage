import { ConfirmDelete } from '../common/ConfirmDelete'

// Asks the user whether they mean to delete a deck, which leaves its cards.
export function ConfirmDeleteDeck({
  name,
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  // The deck's name.
  name: string
  open: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ConfirmDelete
      open={open}
      onCancel={onCancel}
      title={`Delete deck "${name}"?`}
      busy={busy}
      onConfirm={onConfirm}
    >
      This can&apos;t be undone. Its cards won&apos;t be deleted, and keep their
      scores.
    </ConfirmDelete>
  )
}
