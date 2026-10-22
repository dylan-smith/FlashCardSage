import { useState } from 'react'
import type { ChangeEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import {
  documentTypes,
  maxDocumentCandidates,
  scanDocument,
} from '../../api/documentScans'
import { describeFetchError } from '../../api/client'
import { reportFailure } from '../../lib/reportFailure'
import { useCandidateImport } from '../../hooks/useCandidateImport'
import { trackEvent } from '../../telemetry'
import { showToast } from '../../toasts'
import { CardCandidates } from '../cards/CardCandidates'
import { cardCount } from '../../lib/cardCount'
import { documentDeckName } from '../../lib/documentDeckName'

// limitReached is whether the scan made as many cards as it can, so the document may have more, and foundAny whether
// it made any, before the user removed or added some. The cards themselves are the import's.
type ScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | {
      status: 'ready'
      truncated: boolean
      limitReached: boolean
      foundAny: boolean
    }

// Scans a document the user picks for words and phrases to make cards for. They're listed for the user to look over,
// change (with the same form as the cards page) or remove, and then added one at a time or all at once to a deck named
// after the document, made the first time and added to after. A scan makes at most maxDocumentCandidates cards and
// leaves out the user's cards, so a document with more can be scanned again once they're added.
export function DocumentScan() {
  const [state, setState] = useState<ScanState>({ status: 'idle' })
  // The document last scanned, so it can be scanned again.
  const [file, setFile] = useState<File | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const fileName = file?.name ?? ''
  const cards = useCandidateImport({
    deckName: documentDeckName(fileName),
    source: fileName,
    cardSource: 'Document',
    toastKey: 'document-added',
    events: { addedOne: 'DocumentCardAdded', addedAll: 'DocumentCardsAdded' },
    deckOperation: 'documentDeck',
    finishedNote:
      state.status === 'ready' && state.limitReached
        ? 'The document may have more words and phrases, so scan it again to find them.'
        : undefined,
    noDeckAction: { label: 'View cards', to: '/' },
    onFinish: () => setState({ status: 'idle' }),
  })

  async function scan(document: File) {
    setFile(document)
    setState({ status: 'scanning' })
    setErrorMessage('')
    cards.reset()

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
      cards.setCandidates(
        result.candidates.map(({ spanish, english }, key) => ({
          spanish: [spanish],
          english: [english],
          tags: [],
          key,
          picture: null,
        })),
      )
      setState({
        status: 'ready',
        truncated: result.truncated,
        limitReached: result.candidates.length >= maxDocumentCandidates,
        foundAny: result.candidates.length > 0,
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

  const busy = state.status === 'scanning' || cards.adding !== null

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
        {cards.deckError && <Alert severity="error">{cards.deckError}</Alert>}
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
              {`Scanning “${fileName}”. This can take a minute or two…`}
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
              {`${cardCount(cards.candidates.length)} from “${fileName}”`}
            </Typography>
            {cards.candidates.length === 0 ? (
              <Typography color="text.secondary">
                {!state.foundAny
                  ? 'No new words or phrases were found in this document.'
                  : cards.addedCount > 0
                    ? `You added ${cardCount(cards.addedCount)} and removed the rest.`
                    : 'You removed all the cards.'}
              </Typography>
            ) : (
              <CardCandidates
                label="Cards from the document"
                searchable
                {...cards.listProps}
                onError={setErrorMessage}
              />
            )}
          </>
        )}
      </Stack>
    </Box>
  )
}
