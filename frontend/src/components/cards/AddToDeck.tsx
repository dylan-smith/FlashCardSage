import { useId, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { deckNameMaxLength } from '../../api/decks'
import type { Deck } from '../../api/decks'
import { cardCount } from '../../lib/cardCount'

// Puts the cards picked on the cards page into one of the user's decks, or into a new deck named in a dialog.
export function AddToDeck({
  decks,
  count,
  busy,
  onAdd,
  onCreate,
}: {
  decks: Deck[]
  // How many cards are picked.
  count: number
  busy: boolean
  onAdd: (deck: Deck) => void
  // Resolves to why the deck wasn't made, or null when it was, so the dialog can say what's wrong.
  onCreate: (name: string) => Promise<string | null>
}) {
  const id = useId()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  // The new deck's name while the dialog is open, or null when it's closed.
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = await onCreate(name ?? '')
    if (problem === null) {
      setName(null)
    } else {
      setError(problem)
    }
  }

  return (
    <>
      <Button
        id={`${id}-button`}
        type="button"
        variant="contained"
        disabled={busy || count === 0}
        aria-haspopup="true"
        aria-expanded={anchor !== null}
        aria-controls={anchor === null ? undefined : `${id}-menu`}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {count === 0 ? 'Add to deck…' : `Add ${cardCount(count)} to deck…`}
      </Button>
      <Menu
        id={`${id}-menu`}
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { 'aria-labelledby': `${id}-button` } }}
      >
        {decks.map((deck) => (
          <MenuItem
            key={deck.id}
            onClick={() => {
              setAnchor(null)
              onAdd(deck)
            }}
          >
            {deck.name}
          </MenuItem>
        ))}
        {decks.length > 0 && <Divider />}
        <MenuItem
          onClick={() => {
            setAnchor(null)
            setError('')
            setName('')
          }}
        >
          New deck…
        </MenuItem>
      </Menu>
      <Dialog
        open={name !== null}
        onClose={() => setName(null)}
        aria-labelledby={`${id}-title`}
        fullWidth
        maxWidth="xs"
        slotProps={{
          // The name field gets focus once the dialog is open, so the name can be typed straight away.
          transition: { onEntered: () => nameRef.current?.focus() },
        }}
      >
        <DialogTitle id={`${id}-title`}>
          New deck with {cardCount(count)}
        </DialogTitle>
        {/* Inside the dialog rather than as its paper, which has the dialog role that a form can't have. */}
        <form onSubmit={(event) => void handleCreate(event)}>
          <DialogContent>
            <TextField
              inputRef={nameRef}
              label="Deck name"
              value={name ?? ''}
              onChange={(event) => setName(event.target.value)}
              error={error !== ''}
              helperText={error || undefined}
              slotProps={{ htmlInput: { maxLength: deckNameMaxLength } }}
              fullWidth
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button type="button" disabled={busy} onClick={() => setName(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? 'Saving…' : 'Create deck'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  )
}
