import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router'
import { deleteAccount } from '../../api/me'
import { sessionSubject, signOut } from '../../auth/session'
import type { Session } from '../../auth/session'
import { useAction } from '../../hooks/useAction'
import { removeJson } from '../../lib/localJson'
import { storageKeys, userStorageKey } from '../../lib/storageKeys'
import { trackEvent } from '../../telemetry'
import { ConfirmDelete } from '../common/ConfirmDelete'

// What the user types to show they mean it.
const confirmWord = 'DELETE'

// Lets the user delete their account and everything in it, once they've typed a word to show they mean it, and
// signs them out.
export function DeleteAccount({ session }: { session: Session }) {
  const [errorMessage, setErrorMessage] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const deleting = useAction(setErrorMessage)

  function close() {
    setConfirming(false)
    setTyped('')
  }

  async function handleDelete() {
    const deleted = await deleting.run(
      {
        operation: 'deleteAccount',
        fallback: 'Unable to delete your account.',
        reportAll: true,
        keepBusy: true,
      },
      async () => {
        await deleteAccount()
        trackEvent('AccountDeleted')
        // What was kept on this device for practising offline goes too.
        const subject = sessionSubject(session)
        for (const key of [
          storageKeys.practicePack,
          storageKeys.practiceQueue,
          storageKeys.preferences,
        ]) {
          removeJson(userStorageKey(key, subject))
        }
        signOut()
      },
    )
    if (!deleted) {
      close()
    }
  }

  return (
    <>
      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
      )}
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Deleting your account deletes your cards, tags, decks, practice history
        and connected apps for good. The{' '}
        <Link component={RouterLink} to="/privacy">
          privacy policy
        </Link>{' '}
        says what FlashCardSage keeps.
      </Typography>
      <Button
        color="error"
        variant="outlined"
        onClick={() => setConfirming(true)}
      >
        Delete account
      </Button>
      <ConfirmDelete
        open={confirming}
        title="Delete your account?"
        confirmText="Delete account"
        busy={deleting.busy}
        confirmDisabled={typed.trim() !== confirmWord}
        onCancel={close}
        onConfirm={() => void handleDelete()}
        options={
          <TextField
            label={`Type ${confirmWord} to confirm`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            fullWidth
            size="small"
            sx={{ mt: 2 }}
          />
        }
      >
        Everything in your account is deleted for good: your cards and their
        pictures, tags, decks, practice history and connected apps. This
        can&apos;t be undone.
      </ConfirmDelete>
    </>
  )
}
