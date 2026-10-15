import { useId } from 'react'
import type { ReactNode } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'

// Asks the user to say they mean to delete something, since it can't be undone.
export function ConfirmDelete({
  open,
  title,
  children,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  // What will be lost.
  children: ReactNode
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const id = useId()

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onCancel}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle id={`${id}-title`} sx={{ overflowWrap: 'anywhere' }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id={`${id}-text`}>{children}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="contained"
          color="error"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
