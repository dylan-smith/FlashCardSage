import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { DeckImport } from '../api/decks'
import { ApiError, describeFetchError } from '../api/flashCards'
import { importPreplyWords } from '../api/preplyImport'
import {
  clearPreplyHandoff,
  getPreplyHandoff,
  subscribePreplyHandoff,
} from '../preply/preplyHandoff'
import type { PreplyWord } from '../preply/sendToFlashCardSage'
import { trackEvent, trackException } from '../telemetry'
import { cardCount } from './cardCount'
import { ImportedAlert } from './ImportedAlert'
import { PreplyBookmarklet } from './PreplyBookmarklet'

// One word from Preply, with a box to leave it out. A word Preply has no English for can't be a card.
function PreplyWordRow({
  word,
  picked,
  onPick,
}: {
  word: PreplyWord
  picked: boolean
  onPick: () => void
}) {
  const checkboxId = useId()
  const english = word.english ?? 'No English on Preply'
  return (
    <ListItem divider disablePadding sx={{ py: 0.5, gap: 1 }}>
      <Checkbox
        id={checkboxId}
        checked={picked}
        disabled={word.english === null}
        onChange={onPick}
        slotProps={{ input: { 'aria-label': `Pick "${word.spanish}"` } }}
        sx={{ flexShrink: 0, ml: -1.5 }}
      />
      <Box
        component="label"
        htmlFor={checkboxId}
        sx={{
          flexGrow: 1,
          minWidth: 0,
          cursor: word.english === null ? undefined : 'pointer',
        }}
      >
        <ListItemText
          primary={word.spanish}
          secondary={
            word.partOfSpeech ? `${english} · ${word.partOfSpeech}` : english
          }
          sx={{ overflowWrap: 'anywhere' }}
        />
      </Box>
    </ListItem>
  )
}

// The Import cards page's Preply tab, where the "Send to FlashCardSage" bookmarklet brings the user's Preply
// vocabulary. They pick the words to keep, and adding them makes a new Preply deck, leaving out words they already
// have. Until the bookmarklet sends words, it says how to use it.
export function PreplyImport() {
  const handoff = useSyncExternalStore(subscribePreplyHandoff, getPreplyHandoff)
  // The words the user unticked, by their place in the list.
  const [left, setLeft] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState<DeckImport | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  // Most likely Preply changed its API, which only shows up here.
  const failure = handoff.status === 'failed' ? handoff.message : null
  useEffect(() => {
    if (failure !== null) {
      trackException(new Error(failure), { operation: 'readPreply' })
    }
  }, [failure])

  const words = handoff.status === 'received' ? handoff.words : []
  const picked = words.filter(
    (word, index) => word.english !== null && !left.includes(index),
  )

  function togglePicked(index: number) {
    setLeft((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index],
    )
  }

  async function handleImport() {
    setBusy(true)
    setErrorMessage('')

    try {
      const result = await importPreplyWords(
        picked.map((word) => ({
          spanish: word.spanish,
          english: word.english ?? '',
        })),
      )
      trackEvent('PreplyImported', { count: String(result.importedCount) })
      setImported(result)
      setLeft([])
      clearPreplyHandoff()
    } catch (error) {
      // Such as a 409 when the user already has every word, which is theirs to see, not a failure.
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'importPreply' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to add the words.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={2}>
      {imported && <ImportedAlert imported={imported} />}
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {failure !== null && (
        <Alert severity="error">
          Your words couldn&apos;t be read from Preply. {failure}
        </Alert>
      )}

      {handoff.status === 'waiting' && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress aria-label="Loading" size={24} />
            <Typography>Getting your words from Preply…</Typography>
          </Box>
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            If nothing comes, click the bookmark on your Preply vocabulary page
            again.
          </Typography>
        </Box>
      )}

      {handoff.status === 'received' && (
        <Box>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            These are the words in your Preply vocabulary. Untick any you
            don&apos;t want. They&apos;re added to a new Preply deck, leaving
            out words you already have.
          </Typography>
          {words.length === 0 ? (
            <Typography color="text.secondary">
              There aren&apos;t any words in your Preply vocabulary yet.
            </Typography>
          ) : (
            <>
              <List disablePadding aria-label="Preply words">
                {words.map((word, index) => (
                  <PreplyWordRow
                    // Preply can have a word more than once, so its place tells them apart.
                    key={index}
                    word={word}
                    picked={word.english !== null && !left.includes(index)}
                    onPick={() => togglePicked(index)}
                  />
                ))}
              </List>
              <Button
                variant="contained"
                disabled={busy || picked.length === 0}
                onClick={() => void handleImport()}
                sx={{ mt: 2 }}
              >
                {busy
                  ? 'Adding…'
                  : `Add ${cardCount(picked.length)} to a Preply deck`}
              </Button>
            </>
          )}
        </Box>
      )}

      {(handoff.status === 'none' || handoff.status === 'failed') && (
        <PreplyBookmarklet />
      )}
    </Stack>
  )
}
