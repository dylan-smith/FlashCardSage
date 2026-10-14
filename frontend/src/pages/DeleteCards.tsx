import { useId, useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import { cardCount } from './cardCount'

// Deletes the cards picked on the cards page, once the user says so in a dialog, since it can't be undone.
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
  const id = useId()
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
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle id={`${id}-title`}>Delete {cardCount(count)}?</DialogTitle>
        <DialogContent>
          <DialogContentText id={`${id}-text`}>
            They&apos;ll be taken out of any decks they&apos;re in, along with
            their pictures and scores. This can&apos;t be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button type="button" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            color="error"
            disabled={busy}
            onClick={() => void handleDelete()}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
