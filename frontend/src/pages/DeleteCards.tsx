import { useState } from 'react'
import Button from '@mui/material/Button'
import { cardCount } from './cardCount'
import { ConfirmDelete } from './ConfirmDelete'
import { cardDeleteWarning } from './cardDeleteWarning'

// Deletes the cards picked on the cards page or a deck's page, once the user says so in a dialog, since it can't be undone.
export function DeleteCards({
  count,
  busy,
  onDelete,
}: {
  // How many cards are picked.
  count: number
  busy: boolean
  // Resolves once the cards are deleted, or the attempt failed and the page says why.
  onDelete: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)

  async function handleDelete() {
    await onDelete()
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="outlined"
        color="error"
        disabled={busy || count === 0}
        onClick={() => setOpen(true)}
      >
        {count === 0 ? 'Delete…' : `Delete ${cardCount(count)}…`}
      </Button>
      <ConfirmDelete
        open={open}
        title={`Delete ${cardCount(count)}?`}
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() => void handleDelete()}
      >
        {cardDeleteWarning(count)}
      </ConfirmDelete>
    </>
  )
}
