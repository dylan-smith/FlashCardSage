import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { addToNamedDeck } from '../../api/decks'
import {
  documentTypes,
  maxDocumentCandidates,
  scanDocument,
} from '../../api/documentScans'
import {
  createFlashCard,
  createFlashCards,
  formatWords,
} from '../../api/flashCards'
import { ApiError, describeFetchError } from '../../api/client'
import type { FlashCardBatch, FlashCardFields } from '../../api/flashCards'
import { useUserTags } from '../../hooks/useUserTags'
import { trackEvent, trackException } from '../../telemetry'
import { showToast } from '../../toasts'
import { CardCandidates } from '../cards/CardCandidates'
import type { Adding, Candidate } from '../cards/CardCandidates'
import { cardCount } from '../../lib/cardCount'
import { documentDeckName } from '../../lib/documentDeckName'

// limitReached is whether the scan made as many cards as it can, so the document may have more, foundAny whether it made
// any, before the user removed or added some, addedCount how many the user has added so far, and skippedCount how
// many were left out of those added because the user already had them.
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
      skippedCount: number
    }

// The toast for the cards just added, one at a time or all at once, so each replaces the last.
const documentAddedToast = 'document-added'

// What adding the cards did, and whether the document may have more.
type Added = { count: number; skippedCount: number; limitReached: boolean }

// Reports a failure, unless it's an error the API sent for the user to see, such as a document it can't scan, which is
// theirs to fix, not a failure.
function reportFailure(error: unknown, operation: string) {
  if (!(error instanceof ApiError)) {
    trackException(error, { operation })
  }
}

// What adding the cards did, naming the document they're from and the deck they went in.
function describeAdded(
  { count, skippedCount, limitReached }: Added,
  fileName: string,
) {
  let text = `Added ${cardCount(count)} from “${fileName}” to your ${documentDeckName(fileName)} deck.`
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
// change (with the same form as the cards page) or remove, and then added one at a time or all at once to a deck named
// after the document, made the first time and added to after. A scan makes at most maxDocumentCandidates cards and
// leaves out the user's cards, so a document with more can be scanned again once they're added.
export function DocumentScan() {
  const [state, setState] = useState<ScanState>({ status: 'idle' })
  // The document last scanned, so it can be scanned again.
  const [file, setFile] = useState<File | null>(null)
  const [adding, setAdding] = useState<Adding>(null)
  // The deck the cards went in, for the toast's link once they're all added.
  const deckId = useRef<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [deckError, setDeckError] = useState('')
  const [tags, addNewTags] = useUserTags()

  async function scan(document: File) {
    setFile(document)
    setState({ status: 'scanning' })
    setErrorMessage('')
    setDeckError('')
    deckId.current = null

    try {
      const result = await scanDocument(document)
      if (result === null) {
        setState({ status: 'idle' })
        setErrorMessage("Scanning documents isn't available right now.")
        return
      }
      trackEvent('DocumentScanned')
      if (result.candidates.length >= maxDocumentCandidates) {
        showToast({
          key: 'document-limit',
          severity: 'info',
          message: `This document has more words and phrases than one scan finds, so here are the first ${maxDocumentCandidates}. Once you've added them, scan it again for more.`,
        })
      }
      if (result.truncated) {
        showToast({
          key: 'document-truncated',
          severity: 'info',
          message: 'This document is long, so only its start was scanned.',
        })
      }
      setState({
        status: 'ready',
        candidates: result.candidates.map(({ spanish, english }, key) => ({
          spanish: [spanish],
          english: [english],
          tags: [],
          key,
          picture: null,
        })),
        truncated: result.truncated,
        limitReached: result.candidates.length >= maxDocumentCandidates,
        foundAny: result.candidates.length > 0,
        addedCount: 0,
        skippedCount: 0,
      })
    } catch (error) {
      reportFailure(error, 'scan')
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

  // Puts the cards in the document's deck, making it the first time. The cards are added whatever happens to the deck,
  // so a failure is only said.
  async function putInDeck(ids: number[]) {
    if (ids.length === 0 || file === null) {
      return
    }
    const name = documentDeckName(file.name)
    try {
      const deck = await addToNamedDeck(name, ids)
      deckId.current = deck.id
    } catch (error) {
      trackException(error, { operation: 'documentDeck' })
      setDeckError(
        `The cards were added, but couldn't be put in your ${name} deck.`,
      )
    }
  }

  async function addOne(fields: FlashCardFields) {
    const card = await createFlashCard(fields)
    await putInDeck([card.id])
    return card
  }

  async function addAll(fields: FlashCardFields[]) {
    const result = await createFlashCards(fields)
    await putInDeck(result.cards.map((card) => card.id))
    return result
  }

  function handleAdding(value: Adding) {
    setAdding(value)
    if (value !== null) {
      setDeckError('')
    }
  }

  // What adding the cards did, with a link to their deck, or to the cards if they couldn't be put in it.
  function showAdded(added: Added) {
    showToast({
      key: documentAddedToast,
      severity: 'success',
      message: describeAdded(added, file?.name ?? ''),
      action:
        deckId.current === null
          ? { label: 'View cards', to: '/' }
          : { label: 'Open deck', to: `/decks/${deckId.current}` },
    })
  }

  function handleAddedOne(candidate: Candidate) {
    if (state.status !== 'ready') {
      return
    }
    const { candidates, addedCount, skippedCount, limitReached } = state
    trackEvent('DocumentCardAdded')
    const remaining = candidates.filter((item) => item.key !== candidate.key)
    if (remaining.length === 0) {
      // The last one, so the scan's done, as if they'd all been added at once.
      showAdded({ count: addedCount + 1, skippedCount, limitReached })
      setState({ status: 'idle' })
    } else {
      showToast({
        key: documentAddedToast,
        severity: 'success',
        message: `Added “${formatWords(candidate.spanish)}” to your ${documentDeckName(file?.name ?? '')} deck.`,
      })
      setState({ ...state, candidates: remaining, addedCount: addedCount + 1 })
    }
  }

  // All the cards, or just the ones that match a search, so the scan's only done once none are left.
  function handleAddedAll(result: FlashCardBatch, added: Candidate[]) {
    if (state.status !== 'ready') {
      return
    }
    trackEvent('DocumentCardsAdded')
    // With the ones the user added before.
    const addedCount = result.cards.length + state.addedCount
    const skippedCount = result.skippedCount + state.skippedCount
    const remaining = state.candidates.filter(
      (candidate) => !added.some((item) => item.key === candidate.key),
    )
    if (remaining.length === 0) {
      showAdded({
        count: addedCount,
        skippedCount,
        limitReached: state.limitReached,
      })
      setState({ status: 'idle' })
    } else {
      showToast({
        key: documentAddedToast,
        severity: 'success',
        message: describeAdded(
          {
            count: result.cards.length,
            skippedCount: result.skippedCount,
            limitReached: false,
          },
          file?.name ?? '',
        ),
      })
      setState({ ...state, candidates: remaining, addedCount, skippedCount })
    }
  }

  const busy = state.status === 'scanning' || adding !== null

  return (
    <Box>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Choose a document, such as a lesson plan from your Spanish class, an
        article or a story (.txt, .md, .srt, .vtt, .docx or .pdf), to find the
        Spanish words and phrases in it to make cards for. You can change or
        remove them before you add them, one at a time or all at once, to a deck
        named after the document. Words you already have cards for are left out.
      </Typography>
      <Stack spacing={2}>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {deckError && <Alert severity="error">{deckError}</Alert>}
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
            {/* Which document the cards are from, with how many are left to look over. */}
            <Typography
              variant="h6"
              component="h2"
              sx={{ overflowWrap: 'anywhere' }}
            >
              {`${cardCount(state.candidates.length)} from “${file?.name ?? ''}”`}
            </Typography>
            {state.candidates.length === 0 ? (
              <Typography color="text.secondary">
                {!state.foundAny
                  ? 'No new words or phrases were found in this document.'
                  : state.addedCount > 0
                    ? `You added ${cardCount(state.addedCount)} and removed the rest.`
                    : 'You removed all the cards.'}
              </Typography>
            ) : (
              <CardCandidates
                label="Cards from the document"
                searchable
                candidates={state.candidates}
                onCandidatesChange={updateCandidates}
                tags={tags}
                onTagsAdded={addNewTags}
                adding={adding}
                onAddingChange={handleAdding}
                onError={setErrorMessage}
                addOne={addOne}
                addAll={addAll}
                onAddedOne={handleAddedOne}
                onAddedAll={handleAddedAll}
              />
            )}
          </>
        )}
      </Stack>
    </Box>
  )
}
