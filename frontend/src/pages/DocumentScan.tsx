import { useEffect, useState } from 'react'
import type { ChangeEvent, SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import List from '@mui/material/List'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router'
import { cardImageDataUrl, putCardImage } from '../api/cardImages'
import type { CardImage } from '../api/cardImages'
import {
  documentTypes,
  maxDocumentCandidates,
  scanDocument,
} from '../api/documentScans'
import {
  ApiError,
  createFlashCard,
  createFlashCards,
  describeFetchError,
  formatWords,
} from '../api/flashCards'
import type { FlashCard, FlashCardFields, Tag } from '../api/flashCards'
import { listTags } from '../api/tags'
import { useCardPicture } from '../hooks/useCardPicture'
import { trackEvent, trackException } from '../telemetry'
import { cardCount } from './cardCount'
import { trimFields } from './cardFields'
import { FlashCardEditForm } from './FlashCardForm'
import { FlashCardRow } from './FlashCardRow'

// A card made from the document, with a key of its own, since the user can change it like any card: its words, its
// tags and a picture. The picture is kept here until the card is added, and then put on it.
type Candidate = FlashCardFields & { key: number; picture: CardImage | null }

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

// The candidate being changed, as typed so far.
type Editing = FlashCardFields & { key: number }

// Reports a failure, unless it's an error the API sent for the user to see, such as a document it can't scan or a 409
// for a card the user already has, which is theirs to fix, not a failure.
function reportFailure(error: unknown, operation: string) {
  if (!(error instanceof ApiError)) {
    trackException(error, { operation })
  }
}

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

// A candidate as a card, so it's shown like the user's cards are, with its picture if it has one.
function asCard(candidate: Candidate): FlashCard {
  return {
    id: candidate.key,
    spanish: candidate.spanish,
    english: candidate.english,
    tags: candidate.tags.map((name, id) => ({ id, name })),
    imageUrl:
      candidate.picture === null ? null : cardImageDataUrl(candidate.picture),
  }
}

function sameText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

// Scans a document the user picks for words and phrases to make cards for. They're listed for the user to look over,
// change (with the same form as the cards page) or remove, and then added one at a time or all at once. A scan makes
// at most maxDocumentCandidates cards and leaves out the user's cards, so a document with more can be scanned again
// once they're added.
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
  // The user's tags, for the edit form to offer and suggest.
  const [tags, setTags] = useState<Tag[]>([])
  const editingCandidate =
    state.status === 'ready' && editing !== null
      ? state.candidates.find((candidate) => candidate.key === editing.key)
      : undefined
  // The picture the edit form offers: the one the candidate has, if any, or one the user asks for.
  const editPicture = useCardPicture(
    editingCandidate?.picture
      ? cardImageDataUrl(editingCandidate.picture)
      : null,
  )

  // The tags are only needed to change a card's, so the cards still show if they don't load.
  useEffect(() => {
    let cancelled = false
    listTags()
      .then((loaded) => {
        if (!cancelled) {
          setTags(loaded)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trackException(error, { operation: 'loadTags' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // A saved card can have tags the API just made for new names, so they're offered from then on.
  function addNewTags(cards: FlashCard[]) {
    setTags((current) => {
      const added = cards
        .flatMap((card) => card.tags)
        .filter(
          (tag, index, all) =>
            !current.some((item) => item.id === tag.id) &&
            all.findIndex((item) => item.id === tag.id) === index,
        )
      return added.length === 0
        ? current
        : [...current, ...added].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
          )
    })
  }

  async function scan(document: File) {
    setFile(document)
    setState({ status: 'scanning' })
    stopEditing()
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

  function remove(key: number) {
    updateCandidates((candidates) =>
      candidates.filter((candidate) => candidate.key !== key),
    )
  }

  function startEditing(candidate: Candidate) {
    setErrorMessage('')
    editPicture.reset()
    setEditing({
      key: candidate.key,
      spanish: candidate.spanish,
      english: candidate.english,
      tags: candidate.tags,
    })
  }

  function stopEditing() {
    editPicture.reset()
    setEditing(null)
  }

  // Keeps the changes on the candidate, including the picture the user asked for or took off, until it's added.
  function saveEdit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editing === null) {
      return
    }
    const trimmed = trimFields(editing)
    if (typeof trimmed === 'string') {
      setErrorMessage(trimmed)
      return
    }
    setErrorMessage('')
    const { generated, current } = editPicture
    updateCandidates((candidates) =>
      candidates.map((candidate) =>
        candidate.key === editing.key
          ? {
              ...candidate,
              ...trimmed,
              picture:
                generated ?? (current === null ? null : candidate.picture),
            }
          : candidate,
      ),
    )
    stopEditing()
  }

  // Puts each added card's picture on it. The cards are added whatever happens to the pictures, so it returns how
  // many couldn't be.
  async function addPictures(pictures: { id: number; picture: CardImage }[]) {
    let failed = 0
    for (const { id, picture } of pictures) {
      try {
        await putCardImage(id, picture)
        trackEvent('FlashCardImageAdded')
      } catch (error) {
        reportFailure(error, 'picture')
        failed++
      }
    }
    return failed
  }

  function picturesFailedMessage(failed: number) {
    return failed === 1
      ? "A card was added, but its picture couldn't be."
      : `${failed} cards were added, but their pictures couldn't be.`
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
      const card = await createFlashCard({
        spanish: candidate.spanish,
        english: candidate.english,
        tags: candidate.tags,
      })
      trackEvent('DocumentCardAdded')
      addNewTags([card])
      const failed =
        candidate.picture === null
          ? 0
          : await addPictures([{ id: card.id, picture: candidate.picture }])
      if (failed > 0) {
        setErrorMessage(picturesFailedMessage(failed))
      }
      const remaining = candidates.filter((item) => item.key !== candidate.key)
      if (remaining.length === 0) {
        // The last one, so the scan's done, as if they'd all been added at once.
        setAdded({ count: addedCount + 1, skippedCount: 0, limitReached })
        setState({ status: 'idle' })
      } else {
        setAddedOne(`Added “${formatWords(candidate.spanish)}”.`)
        setState({
          ...state,
          candidates: remaining,
          addedCount: addedCount + 1,
        })
      }
    } catch (error) {
      reportFailure(error, 'add')
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
        candidates.map(({ spanish, english, tags }) => ({
          spanish,
          english,
          tags,
        })),
      )
      trackEvent('DocumentCardsAdded')
      addNewTags(result.cards)
      // The cards that were added come back without the ones left out, so each picture finds its card by its first
      // Spanish word, which no other card can have.
      const pictures = candidates.flatMap(({ spanish, picture }) => {
        const card = result.cards.find((item) =>
          sameText(item.spanish[0] ?? '', spanish[0] ?? ''),
        )
        return card === undefined || picture === null
          ? []
          : [{ id: card.id, picture }]
      })
      const failed = await addPictures(pictures)
      if (failed > 0) {
        setErrorMessage(picturesFailedMessage(failed))
      }
      setAdded({
        // With the ones the user added one at a time before.
        count: result.cards.length + addedCount,
        skippedCount: result.skippedCount,
        limitReached,
      })
      setState({ status: 'idle' })
    } catch (error) {
      reportFailure(error, 'add')
      setErrorMessage(describeFetchError(error, 'Unable to add the cards.'))
    } finally {
      setAdding(null)
    }
  }

  const busy = state.status === 'scanning' || adding !== null

  return (
    <Box>
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
                  {state.candidates.map((candidate) => {
                    if (editing?.key === candidate.key) {
                      return (
                        <FlashCardEditForm
                          key={candidate.key}
                          edit={editing}
                          tags={tags}
                          picture={editPicture}
                          busy={adding !== null}
                          onChange={(update) =>
                            setEditing((current) =>
                              current === null
                                ? null
                                : { ...current, ...update(current) },
                            )
                          }
                          onCancel={() => {
                            setErrorMessage('')
                            stopEditing()
                          }}
                          onSave={saveEdit}
                        />
                      )
                    }
                    const spanish = formatWords(candidate.spanish)
                    return (
                      <FlashCardRow
                        key={candidate.key}
                        card={asCard(candidate)}
                        actions={
                          <>
                            <Button
                              type="button"
                              size="small"
                              disabled={adding !== null || editing !== null}
                              aria-label={`Add "${spanish}"`}
                              onClick={() => void addOne(candidate)}
                              sx={{ flexShrink: 0 }}
                            >
                              {adding === candidate.key ? 'Adding…' : 'Add'}
                            </Button>
                            <Button
                              type="button"
                              size="small"
                              disabled={adding !== null}
                              aria-label={`Edit "${spanish}"`}
                              onClick={() => startEditing(candidate)}
                              sx={{ flexShrink: 0 }}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="small"
                              color="error"
                              disabled={adding !== null}
                              aria-label={`Remove "${spanish}"`}
                              onClick={() => remove(candidate.key)}
                              sx={{ flexShrink: 0 }}
                            >
                              Remove
                            </Button>
                          </>
                        }
                      />
                    )
                  })}
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
    </Box>
  )
}
