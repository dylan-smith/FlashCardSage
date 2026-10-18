import { useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import ListItem from '@mui/material/ListItem'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { listFlashCards } from '../api/flashCards'
import type { Tag } from '../api/flashCards'
import { byName } from '../lib/text'
import {
  createTag,
  deleteTag,
  listTags,
  renameTag,
  tagMaxLength,
  tagNameRequiredMessage,
} from '../api/tags'
import { usePreferences } from '../hooks/usePreferences'
import { trackEvent } from '../telemetry'
import { useAction } from '../hooks/useAction'
import { useConfirm } from '../hooks/useConfirm'
import { useLoad } from '../hooks/useLoad'
import { EmptyText } from '../components/common/EmptyText'
import { Loading } from '../components/common/Loading'
import { NameForm } from '../components/common/NameForm'
import { NamedItemRow } from '../components/common/NamedItemRow'
import { Section } from '../components/common/Section'
import {
  AnimatedList,
  AnimatedListItem,
} from '../components/common/AnimatedList'
import { cardCount } from '../lib/cardCount'
import { ConfirmDelete } from '../components/common/ConfirmDelete'
import { RenameForm } from '../components/cards/FlashCardTags'
import { TagSuggestions } from '../components/cards/TagSuggestions'

// Tags in name order whatever their case, as the API sends them.
function sortTags(tags: Tag[]) {
  return [...tags].sort(byName)
}

// The user's tags, with how many cards have each. Tags are made here, from a suggestion here, or by naming them on a
// card, and here they can be renamed or deleted (optionally replaced by another tag, merging the two).
function TagsPage() {
  const [errorMessage, setErrorMessage] = useState('')
  // The user's tags, and the ids of the cards with each tag, by its id, to count them and to merge them when a tag is
  // replaced. The cards are only loaded for that.
  const page = useLoad(
    async () => {
      const [tags, cards] = await Promise.all([listTags(), listFlashCards()])
      const tagCards = new Map<number, Set<number>>()
      for (const card of cards) {
        for (const tag of card.tags) {
          const ids = tagCards.get(tag.id) ?? new Set<number>()
          ids.add(card.id)
          tagCards.set(tag.id, ids)
        }
      }
      return { tags, tagCards }
    },
    [],
    {
      operation: 'load',
      fallback: 'Unable to load tags.',
      onError: setErrorMessage,
      initial: { tags: [] as Tag[], tagCards: new Map<number, Set<number>>() },
    },
  )
  const { tags, tagCards } = page.data
  // The new tag's name as typed so far.
  const [name, setName] = useState('')
  const creating = useAction(setErrorMessage)
  const addingSuggestion = useAction(setErrorMessage)
  // The tag being renamed and its new name as typed so far. One at a time keeps the list simple.
  const [rename, setRename] = useState<{ id: number; name: string } | null>(
    null,
  )
  // The tag being renamed or deleted, so its buttons can wait for the API.
  const tagAction = useAction<number>(setErrorMessage)
  const busyId = tagAction.busyKey
  // The tag whose Delete was clicked, while the user is asked whether they mean it.
  const confirm = useConfirm<Tag>()
  const confirming = confirm.target
  // The id of the tag picked to go on its cards instead, or '' to just take it off them.
  const [replacementId, setReplacementId] = useState('')
  const showSuggestions = usePreferences()?.showSuggestions === true

  function setTags(update: (current: Tag[]) => Tag[]) {
    page.setData((current) => ({ ...current, tags: update(current.tags) }))
  }

  // Makes a tag with this name, typed or suggested, resolving to whether it was saved.
  async function addTag(
    newName: string,
    event: string,
    action: typeof creating,
  ) {
    const trimmed = newName.trim()
    if (!trimmed) {
      setErrorMessage(tagNameRequiredMessage)
      return false
    }

    return action.run(
      { operation: 'createTag', fallback: 'Unable to save tag.' },
      async () => {
        const created = await createTag(trimmed)
        trackEvent(event)
        setTags((current) => sortTags([...current, created]))
      },
    )
  }

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await addTag(name, 'TagCreated', creating)) {
      setName('')
    }
  }

  async function handleRename(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (rename === null) {
      return
    }
    const trimmed = rename.name.trim()
    if (!trimmed) {
      setErrorMessage(tagNameRequiredMessage)
      return
    }

    await tagAction.run(
      {
        operation: 'renameTag',
        fallback: 'Unable to rename tag.',
        key: rename.id,
      },
      async () => {
        const renamed = await renameTag(rename.id, trimmed)
        trackEvent('TagRenamed')
        setTags((current) =>
          sortTags(
            current.map((item) => (item.id === renamed.id ? renamed : item)),
          ),
        )
        setRename(null)
      },
    )
  }

  // How many cards have this tag, in words.
  function tagCardCount(id: number) {
    return cardCount(tagCards.get(id)?.size ?? 0)
  }

  function confirmDelete(tag: Tag) {
    setReplacementId('')
    confirm.ask(tag)
  }

  // Deleting a tag takes it off its cards but leaves the cards. With a replacement picked, that tag goes on them
  // instead, which merges the two.
  async function handleDelete(tag: Tag) {
    const replacement = replacementId === '' ? undefined : Number(replacementId)
    await tagAction.run(
      {
        operation: 'deleteTag',
        fallback: 'Unable to delete tag.',
        key: tag.id,
        reportAll: true,
      },
      async () => {
        await deleteTag(tag.id, replacement)
        trackEvent(replacement === undefined ? 'TagDeleted' : 'TagReplaced')
        setTags((current) => current.filter((item) => item.id !== tag.id))
        if (replacement !== undefined) {
          page.setData((current) => {
            const merged = new Map(current.tagCards)
            merged.set(
              replacement,
              new Set([
                ...(current.tagCards.get(replacement) ?? []),
                ...(current.tagCards.get(tag.id) ?? []),
              ]),
            )
            return { ...current, tagCards: merged }
          })
        }
      },
    )
    confirm.close()
  }

  return (
    <Stack spacing={2}>
      <Section title="New tag">
        <NameForm
          id="new-tag-name"
          label="New tag name"
          placeholder="e.g. Food"
          maxLength={tagMaxLength}
          value={name}
          busy={creating.busy}
          submitText="Create tag"
          onChange={setName}
          onSubmit={(event) => void handleCreate(event)}
        />
      </Section>

      {showSuggestions && !page.loading && !page.failed && (
        <TagSuggestions
          tags={tags}
          onAdd={(suggested) =>
            addTag(suggested, 'SuggestedTagAdded', addingSuggestion)
          }
        />
      )}

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      <Section title="Tags">
        {page.loading ? (
          <Loading />
        ) : page.failed ? null : tags.length === 0 ? (
          <EmptyText>
            You haven&apos;t made any tags yet. Create one above, or add one to
            a card on the Cards page.
          </EmptyText>
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
                    <RenameForm
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
                  <NamedItemRow
                    name={tag.name}
                    to={`/?tag=${tag.id}`}
                    secondary={tagCardCount(tag.id)}
                  >
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
                      onClick={() => confirmDelete(tag)}
                    >
                      Delete
                    </Button>
                  </NamedItemRow>
                </AnimatedListItem>
              ),
            )}
          </AnimatedList>
        )}
        {confirming !== null && (
          <ConfirmDelete
            {...confirm.dialogProps}
            title={`Delete tag "${confirming.name}"?`}
            busy={busyId === confirming.id}
            onConfirm={() => void handleDelete(confirming)}
            options={
              // Only another tag can replace it, and there might not be one.
              tags.length > 1 && (
                <TextField
                  select
                  label="Replace with"
                  helperText="Put another tag on its cards instead, merging the two."
                  value={replacementId}
                  onChange={(event) => setReplacementId(event.target.value)}
                  disabled={busyId === confirming.id}
                  // "No tag" is shown rather than an empty field.
                  slotProps={{
                    select: { displayEmpty: true },
                    inputLabel: { shrink: true },
                  }}
                  fullWidth
                  sx={{ mt: 3 }}
                >
                  <MenuItem value="">No tag</MenuItem>
                  {tags
                    .filter((item) => item.id !== confirming.id)
                    .map((item) => (
                      <MenuItem key={item.id} value={String(item.id)}>
                        {item.name}
                      </MenuItem>
                    ))}
                </TextField>
              )
            }
          >
            This can&apos;t be undone.{' '}
            {replacementId === ''
              ? "It'll be taken off its"
              : `"${tags.find((item) => String(item.id) === replacementId)?.name}" will take its place on its`}{' '}
            {tagCardCount(confirming.id)}, but the cards won&apos;t be deleted,
            and keep their scores.
          </ConfirmDelete>
        )}
      </Section>
    </Stack>
  )
}

export default TagsPage
