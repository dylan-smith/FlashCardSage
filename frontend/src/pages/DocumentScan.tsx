import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router'
import type { CardSuggestion } from '../api/cardSuggestions'
import {
  documentTypes,
  maxDocumentCandidates,
  scanDocument,
} from '../api/documentScans'
import {
  createFlashCard,
  createFlashCards,
  describeFetchError,
} from '../api/flashCards'
import { trackEvent, trackException } from '../telemetry'
import { cardCount } from './cardCount'

// A card made from the document, with a key of its own, since the user can change its words.
type Candidate = CardSuggestion & { key: number }

// limitReached is whether the scan made as many cards as it can, so the document may have more, foundAny whether it made
// any, before the user removed or added some, and addedCount how many the user has added one at a time.
type ScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | {
      status: 'ready'
      candidates: Candidate[]
      truncated: boolean
      limitReached: boolean
      foundAny: boolean
      addedCount: number
    }

// What adding the cards did, and whether the document may have more.
type Added = { count: number; skippedCount: number; limitReached: boolean }

// The candidate being changed, with its words as typed so far.
type Editing = { key: number; spanish: string; english: string }

function describeAdded({ count, skippedCount, limitReached }: Added) {
  let text = `Added ${cardCount(count)}.`
  if (skippedCount > 0) {
    text += ` ${skippedCount === 1 ? '1 card was' : `${skippedCount} cards were`} left out because you already have ${skippedCount === 1 ? 'it' : 'them'}.`
  }
  if (limitReached) {
    text +=
      ' The document may have more words and phrases, so scan it again to find them.'
  }
  return text
}

// Scans a document the user picks for words and phrases to make cards for. They're listed for the user to look over,
// change or remove, and then added one at a time or all at once. A scan makes at most maxDocumentCandidates cards and leaves out the
// user's cards, so a document with more can be scanned again once they're added.
export function DocumentScan() {
  const [state, setState] = useState<ScanState>({ status: 'idle' })
  // The document last scanned, so it can be scanned again.
  const [file, setFile] = useState<File | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  // What's being added: all the cards, or the one with this key.
  const [adding, setAdding] = useState<'all' | number | null>(null)
  // The card just added on its own, which has left the list, so the user sees it went in.
  const [addedOne, setAddedOne] = useState('')
  const [added, setAdded] = useState<Added | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const spanishRef = useRef<HTMLInputElement>(null)

  // Clicking Edit replaces the button with the fields, so the first one takes the focus in its place.
  const editingKey = editing?.key
  useEffect(() => {
    if (editingKey !== undefined) {
      spanishRef.current?.focus()
    }
  }, [editingKey])

  async function scan(document: File) {
    setFile(document)
    setState({ status: 'scanning' })
    setEditing(null)
    setAdded(null)
    setAddedOne('')
    setErrorMessage('')

    try {
      const result = await scanDocument(document)
      if (result === null) {
        setState({ status: 'idle' })
        setErrorMessage("Scanning documents isn't available right now.")
        return
      }
      trackEvent('DocumentScanned')
      setState({
        status: 'ready',
        candidates: result.candidates.map((candidate, key) => ({
          ...candidate,
          key,
        })),
        truncated: result.truncated,
        limitReached: result.candidates.length >= maxDocumentCandidates,
        foundAny: result.candidates.length > 0,
        addedCount: 0,
      })
    } catch (error) {
      trackException(error, { operation: 'scan' })
      setState({ status: 'idle' })
      setErrorMessage(describeFetchError(error, 'Unable to scan the document.'))
    }
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0]
    // Cleared, so picking the same document again scans it again.
    event.target.value = ''
    if (picked) {
      void scan(picked)
    }
  }

  function updateCandidates(update: (candidates: Candidate[]) => Candidate[]) {
    setState((current) =>
      current.status === 'ready'
        ? { ...current, candidates: update(current.candidates) }
        : current,
    )
  }

  function remove(key: number) {
    updateCandidates((candidates) =>
      candidates.filter((candidate) => candidate.key !== key),
    )
  }

  function saveEdit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editing === null) {
      return
    }
    const spanish = editing.spanish.trim()
    const english = editing.english.trim()
    updateCandidates((candidates) =>
      candidates.map((candidate) =>
        candidate.key === editing.key
          ? { ...candidate, spanish, english }
          : candidate,
      ),
    )
    setEditing(null)
  }

  async function addOne(candidate: Candidate) {
    if (state.status !== 'ready') {
      return
    }
    const { candidates, addedCount, limitReached } = state
    setAdding(candidate.key)
    setAddedOne('')
    setErrorMessage('')

    try {
      await createFlashCard({
        spanish: [candidate.spanish],
        english: [candidate.english],
        tags: [],
      })
      trackEvent('DocumentCardAdded')
      const remaining = candidates.filter((item) => item.key !== candidate.key)
      if (remaining.length === 0) {
        // The last one, so the scan's done, as if they'd all been added at once.
        setAdded({ count: addedCount + 1, skippedCount: 0, limitReached })
        setState({ status: 'idle' })
      } else {
        setAddedOne(`Added “${candidate.spanish}”.`)
        setState({
          ...state,
          candidates: remaining,
          addedCount: addedCount + 1,
        })
      }
    } catch (error) {
      trackException(error, { operation: 'add' })
      setErrorMessage(describeFetchError(error, 'Unable to add the card.'))
    } finally {
      setAdding(null)
    }
  }

  async function addAll(
    candidates: Candidate[],
    addedCount: number,
    limitReached: boolean,
  ) {
    setAdding('all')
    setAddedOne('')
    setErrorMessage('')

    try {
      const result = await createFlashCards(
        candidates.map(({ spanish, english }) => ({
          spanish: [spanish],
          english: [english],
          tags: [],
        })),
      )
      trackEvent('DocumentCardsAdded')
      setAdded({
        // With the ones the user added one at a time before.
        count: result.cards.length + addedCount,
        skippedCount: result.skippedCount,
        limitReached,
      })
      setState({ status: 'idle' })
    } catch (error) {
      trackException(error, { operation: 'add' })
      setErrorMessage(describeFetchError(error, 'Unable to add the cards.'))
    } finally {
      setAdding(null)
    }
  }

  const busy = state.status === 'scanning' || adding !== null

  return (
    <Paper component="section" elevation={2} sx={{ p: 3 }}>
      <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
        From a document
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Choose a document in Spanish, such as an article, a story or a
        film&apos;s subtitles (.txt, .md, .srt, .vtt, .docx or .pdf), to find
        words and phrases in it to make cards for. You can change or remove them
        before you add them, one at a time or all at once. Words you already
        have cards for are left out.
      </Typography>
      <Stack spacing={2}>
        {added && (
          <Alert
            severity="success"
            action={
              <Button
                component={RouterLink}
                to="/"
                color="inherit"
                size="small"
              >
                View cards
              </Button>
            }
          >
            {describeAdded(added)}
          </Alert>
        )}
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button variant="outlined" component="label" disabled={busy}>
            Choose a document
            <input
              type="file"
              hidden
              accept={documentTypes}
              disabled={busy}
              onChange={handlePick}
            />
          </Button>
          {file && state.status === 'idle' && (
            <Button type="button" onClick={() => void scan(file)}>
              Scan it again
            </Button>
          )}
        </Box>
        {state.status === 'scanning' && (
          <Box
            role="status"
            sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}
          >
            <CircularProgress aria-hidden size={32} />
            <Typography sx={{ overflowWrap: 'anywhere' }}>
              {`Scanning “${file?.name ?? ''}”. This can take a minute or two…`}
            </Typography>
          </Box>
        )}
        {state.status === 'ready' && (
          <>
            {state.limitReached && (
              <Alert severity="info">
                {`This document has more words and phrases than one scan finds, so here are the first ${maxDocumentCandidates}. Once you've added them, scan it again for more.`}
              </Alert>
            )}
            {state.truncated && (
              <Alert severity="info">
                This document is long, so only its start was scanned.
              </Alert>
            )}
            {addedOne && <Alert severity="success">{addedOne}</Alert>}
            {state.candidates.length === 0 ? (
              <Typography color="text.secondary">
                {!state.foundAny
                  ? 'No new words or phrases were found in this document.'
                  : state.addedCount > 0
                    ? `You added ${cardCount(state.addedCount)} and removed the rest.`
                    : 'You removed all the cards.'}
              </Typography>
            ) : (
              <>
                <List disablePadding aria-label="Cards from the document">
                  {state.candidates.map((candidate) =>
                    editing?.key === candidate.key ? (
                      <ListItem
                        key={candidate.key}
                        divider
                        disablePadding
                        sx={{ py: 1 }}
                      >
                        <Box
                          component="form"
                          onSubmit={saveEdit}
                          sx={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: 1,
                            width: '100%',
                          }}
                        >
                          <TextField
                            label="Spanish"
                            size="small"
                            required
                            inputRef={spanishRef}
                            value={editing.spanish}
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                spanish: event.target.value,
                              })
                            }
                            sx={{ flex: '1 1 10rem' }}
                          />
                          <TextField
                            label="English"
                            size="small"
                            required
                            value={editing.english}
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                english: event.target.value,
                              })
                            }
                            sx={{ flex: '1 1 10rem' }}
                          />
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                              type="submit"
                              size="small"
                              variant="contained"
                              disabled={
                                !editing.spanish.trim() ||
                                !editing.english.trim()
                              }
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              size="small"
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </Button>
                          </Box>
                        </Box>
                      </ListItem>
                    ) : (
                      <ListItem
                        key={candidate.key}
                        divider
                        disablePadding
                        sx={{ py: 1, gap: 1 }}
                      >
                        <ListItemText
                          primary={candidate.spanish}
                          secondary={candidate.english}
                          sx={{ overflowWrap: 'anywhere' }}
                        />
                        <Button
                          type="button"
                          size="small"
                          disabled={adding !== null || editing !== null}
                          aria-label={`Add "${candidate.spanish}"`}
                          onClick={() => void addOne(candidate)}
                          sx={{ flexShrink: 0 }}
                        >
                          {adding === candidate.key ? 'Adding…' : 'Add'}
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          disabled={adding !== null}
                          aria-label={`Edit "${candidate.spanish}"`}
                          onClick={() =>
                            setEditing({
                              key: candidate.key,
                              spanish: candidate.spanish,
                              english: candidate.english,
                            })
                          }
                          sx={{ flexShrink: 0 }}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          color="error"
                          disabled={adding !== null}
                          aria-label={`Remove "${candidate.spanish}"`}
                          onClick={() => remove(candidate.key)}
                          sx={{ flexShrink: 0 }}
                        >
                          Remove
                        </Button>
                      </ListItem>
                    ),
                  )}
                </List>
                <Box>
                  <Button
                    type="button"
                    variant="contained"
                    disabled={adding !== null || editing !== null}
                    onClick={() =>
                      void addAll(
                        state.candidates,
                        state.addedCount,
                        state.limitReached,
                      )
                    }
                  >
                    {adding === 'all'
                      ? 'Adding…'
                      : state.candidates.length === 1
                        ? 'Add 1 card'
                        : `Add all ${state.candidates.length} cards`}
                  </Button>
                </Box>
              </>
            )}
          </>
        )}
      </Stack>
    </Paper>
  )
}
