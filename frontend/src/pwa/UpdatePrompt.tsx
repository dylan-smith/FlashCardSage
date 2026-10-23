import { useState } from 'react'
import Button from '@mui/material/Button'
import Snackbar from '@mui/material/Snackbar'
import { reloadPage, updateReady } from './serviceWorker'

// Offers to reload once a new version of the app is ready. It waits for the user rather than reloading by itself, so
// it never interrupts a practice session, and stays until they reload or close it.
function UpdatePrompt() {
  const ready = updateReady.use()
  const [dismissed, setDismissed] = useState(false)

  return (
    <Snackbar
      open={ready && !dismissed}
      message="A new version of FlashCardSage is available."
      onClose={(_event, reason) => {
        if (reason !== 'clickaway') {
          setDismissed(true)
        }
      }}
      action={
        <Button color="inherit" size="small" onClick={reloadPage}>
          Reload
        </Button>
      }
    />
  )
}

export default UpdatePrompt
