import { useState } from 'react'

// What the user is asked to confirm, such as the card whose Delete they clicked, for a ConfirmDelete. Closing keeps
// the target, so the dialog can stay mounted and show it while it animates out.
export function useConfirm<T>() {
  const [target, setTarget] = useState<T | null>(null)
  const [open, setOpen] = useState(false)

  function ask(value: T) {
    setTarget(value)
    setOpen(true)
  }

  function close() {
    setOpen(false)
  }

  return {
    // What was last asked about, which is kept once the dialog closes.
    target,
    // Whether the dialog is showing.
    open,
    ask,
    close,
    dialogProps: { open, onCancel: close },
  }
}
