import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router'
import { ApiError, describeFetchError, listFlashCards } from '../api/flashCards'
import type { Tag } from '../api/flashCards'
import { createTag, deleteTag, listTags, renameTag } from '../api/tags'
import { usePreferences } from '../hooks/usePreferences'
import { trackEvent, trackException } from '../telemetry'
import { AnimatedList, AnimatedListItem } from './AnimatedList'
import { cardCount } from './cardCount'
import { ConfirmDelete } from './ConfirmDelete'
import { TagRenameForm, tagMaxLength } from './FlashCardTags'
import { TagSuggestions } from './TagSuggestions'

// Tags in name order whatever their case, as the API sends them.
function sortTags(tags: Tag[]) {
  return [...tags].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

// The user's tags, with how many cards have each. Tags are made here, from a suggestion here, or by naming them on a
// card, and here they can be renamed or deleted.
function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([])
  // How many cards have each tag, by its id.
  const [counts, setCounts] = useState<Map<number, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  // The new tag's name as typed so far.
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  // The tag being renamed and its new name as typed so far. One at a time keeps the list simple.
  const [rename, setRename] = useState<{ id: number; name: string } | null>(
    null,
  )
  // The tag being renamed or deleted, so its buttons can wait for the API.
  const [busyId, setBusyId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  // The tag whose Delete was clicked, while the user is asked whether they mean it.
  const [confirmingDelete, setConfirmingDelete] = useState<Tag | null>(null)
  const showSuggestions = usePreferences()?.showSuggestions === true

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

  // Makes a tag with this name, typed or suggested, resolving to whether it was saved.
  async function addTag(newName: string, event: string) {
    const trimmed = newName.trim()
    if (!trimmed) {
      setErrorMessage('Tag name is required.')
      return false
    }

    setErrorMessage('')

    try {
      const created = await createTag(trimmed)
      trackEvent(event)
      setTags((current) => sortTags([...current, created]))
      return true
    } catch (error) {
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'createTag' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to save tag.'))
      return false
    }
  }

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreating(true)
    try {
      if (await addTag(name, 'TagCreated')) {
        setName('')
      }
    } finally {
      setCreating(false)
    }
  }

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
      setConfirmingDelete(null)
    }
  }

  return (
    <Stack spacing={2}>
      <Paper component="section" elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          New tag
        </Typography>
        <Box
          component="form"
          onSubmit={(event) => void handleCreate(event)}
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'flex-start' },
            gap: 2,
          }}
        >
          <TextField
            id="new-tag-name"
            label="New tag name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: tagMaxLength } }}
            required
            placeholder="e.g. Food"
            sx={{ flexGrow: 1 }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={creating}
            sx={{ flexShrink: 0, alignSelf: { sm: 'center' } }}
          >
            {creating ? 'Saving…' : 'Create tag'}
          </Button>
        </Box>
      </Paper>

      {showSuggestions && !loading && !loadFailed && (
        <TagSuggestions
          tags={tags}
          onAdd={(suggested) => addTag(suggested, 'SuggestedTagAdded')}
        />
      )}

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

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
            You haven&apos;t made any tags yet. Create one above, or add one to
            a card on the Cards page.
          </Typography>
        ) : (
          <AnimatedList disablePadding>
            {tags.map((tag) =>
              rename?.id === tag.id ? (
                <AnimatedListItem key={`${tag.id}-rename`}>
                  <ListItem
                    component="div"
                    divider
                    disablePadding
                    sx={{ pb: 1 }}
                  >
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
                </AnimatedListItem>
              ) : (
                <AnimatedListItem key={tag.id}>
                  <ListItem
                    component="div"
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
                        onClick={() => setConfirmingDelete(tag)}
                      >
                        Delete
                      </Button>
                    </Box>
                  </ListItem>
                </AnimatedListItem>
              ),
            )}
          </AnimatedList>
        )}
        {confirmingDelete !== null && (
          <ConfirmDelete
            open
            title={`Delete tag "${confirmingDelete.name}"?`}
            busy={busyId === confirmingDelete.id}
            onCancel={() => setConfirmingDelete(null)}
            onConfirm={() => void handleDelete(confirmingDelete)}
          >
            This can&apos;t be undone. It&apos;ll be taken off its{' '}
            {cardCount(counts.get(confirmingDelete.id) ?? 0)}, but the cards
            won&apos;t be deleted, and keep their scores.
          </ConfirmDelete>
        )}
      </Paper>
    </Stack>
  )
}

export default TagsPage
