import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router'
import { ApiError, describeFetchError, listFlashCards } from '../api/flashCards'
import type { Tag } from '../api/flashCards'
import { deleteTag, listTags, renameTag } from '../api/tags'
import { trackEvent, trackException } from '../telemetry'
import { cardCount } from './cardCount'
import { TagRenameForm } from './FlashCardTags'

// Tags in name order whatever their case, as the API sends them.
function sortTags(tags: Tag[]) {
  return [...tags].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

// The user's tags, with how many cards have each. Tags are made by naming them on a card, and here they can be
// renamed or deleted.
function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([])
  // How many cards have each tag, by its id.
  const [counts, setCounts] = useState<Map<number, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  // The tag being renamed and its new name as typed so far. One at a time keeps the list simple.
  const [rename, setRename] = useState<{ id: number; name: string } | null>(
    null,
  )
  // The tag being renamed or deleted, so its buttons can wait for the API.
  const [busyId, setBusyId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  // The cards are only loaded to count each tag's.
  useEffect(() => {
    let cancelled = false
    Promise.all([listTags(), listFlashCards()])
      .then(([loadedTags, cards]) => {
        if (!cancelled) {
          const loadedCounts = new Map<number, number>()
          for (const tag of cards.flatMap((card) => card.tags)) {
            loadedCounts.set(tag.id, (loadedCounts.get(tag.id) ?? 0) + 1)
          }
          setTags(loadedTags)
          setCounts(loadedCounts)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trackException(error, { operation: 'load' })
          setLoadFailed(true)
          setErrorMessage(describeFetchError(error, 'Unable to load tags.'))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRename(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (rename === null) {
      return
    }
    const trimmed = rename.name.trim()
    if (!trimmed) {
      setErrorMessage('Tag name is required.')
      return
    }

    setBusyId(rename.id)
    setErrorMessage('')

    try {
      const renamed = await renameTag(rename.id, trimmed)
      trackEvent('TagRenamed')
      setTags((current) =>
        sortTags(
          current.map((item) => (item.id === renamed.id ? renamed : item)),
        ),
      )
      setRename(null)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'renameTag' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to rename tag.'))
    } finally {
      setBusyId(null)
    }
  }

  // Deleting a tag takes it off its cards but leaves the cards.
  async function handleDelete(tag: Tag) {
    setBusyId(tag.id)
    setErrorMessage('')

    try {
      await deleteTag(tag.id)
      trackEvent('TagDeleted')
      setTags((current) => current.filter((item) => item.id !== tag.id))
    } catch (error) {
      trackException(error, { operation: 'deleteTag' })
      setErrorMessage(describeFetchError(error, 'Unable to delete tag.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
      )}
      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          Tags
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading" />
          </Box>
        ) : loadFailed ? null : tags.length === 0 ? (
          <Typography color="text.secondary">
            You haven&apos;t made any tags yet. Add one to a card on the Cards
            page.
          </Typography>
        ) : (
          <List disablePadding>
            {tags.map((tag) =>
              rename?.id === tag.id ? (
                <ListItem key={tag.id} divider disablePadding sx={{ pb: 1 }}>
                  <TagRenameForm
                    name={rename.name}
                    busy={busyId === tag.id}
                    onChange={(name) => setRename({ id: tag.id, name })}
                    onCancel={() => {
                      setErrorMessage('')
                      setRename(null)
                    }}
                    onSave={(event) => void handleRename(event)}
                  />
                </ListItem>
              ) : (
                <ListItem
                  key={tag.id}
                  divider
                  disablePadding
                  sx={{ py: 1, gap: 1 }}
                >
                  {/* The name wraps rather than the buttons, so they stay together on a phone. */}
                  <ListItemText
                    primary={
                      <Link component={RouterLink} to={`/?tag=${tag.id}`}>
                        {tag.name}
                      </Link>
                    }
                    secondary={cardCount(counts.get(tag.id) ?? 0)}
                    sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                  />
                  <Box sx={{ display: 'flex', flexShrink: 0 }}>
                    <Button
                      type="button"
                      aria-label={`Rename tag "${tag.name}"`}
                      disabled={busyId === tag.id}
                      onClick={() => {
                        setErrorMessage('')
                        setRename({ id: tag.id, name: tag.name })
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      type="button"
                      color="error"
                      aria-label={`Delete tag "${tag.name}"`}
                      disabled={busyId === tag.id}
                      onClick={() => void handleDelete(tag)}
                    >
                      Delete
                    </Button>
                  </Box>
                </ListItem>
              ),
            )}
          </List>
        )}
      </Paper>
    </>
  )
}

export default TagsPage
