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
  options,
  busy,
  confirmText = 'Delete',
  busyText = 'Deleting…',
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  // What will be lost.
  children: ReactNode
  // Fields that change what deleting does, shown under what will be lost.
  options?: ReactNode
  busy: boolean
  // The confirm button, and what it says while it waits for the API, for something other than deleting, such as
  // disconnecting an app.
  confirmText?: string
  busyText?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const id = useId()

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onCancel}
      // The rest of the page is back as soon as the dialog starts to close, rather than once it has faded out.
      closeAfterTransition={false}
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
        {options}
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
          {busy ? busyText : confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
