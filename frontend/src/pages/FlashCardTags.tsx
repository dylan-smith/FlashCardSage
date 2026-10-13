import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { Tag } from '../api/flashCards'

// The most a tag name can be, as the API allows.
export const tagMaxLength = 50

// Picks a card's tags by name from the user's tags, or makes a new one by typing a name. The typed name is added on
// Enter, and when the field loses focus, so clicking Save straight after typing keeps it.
export function TagsInput({
  value,
  tags,
  onChange,
  size,
}: {
  value: string[]
  tags: Tag[]
  onChange: (names: string[]) => void
  size?: 'small'
}) {
  return (
    <Autocomplete
      multiple
      freeSolo
      autoSelect
      filterSelectedOptions
      options={tags.map((tag) => tag.name)}
      value={value}
      onChange={(_event, names) => onChange(names)}
      size={size}
      fullWidth
      renderInput={(params) => (
        <TextField
          {...params}
          label="Tags"
          placeholder={value.length === 0 ? 'e.g. Food' : undefined}
          slotProps={{
            ...params.slotProps,
            htmlInput: {
              ...params.slotProps.htmlInput,
              maxLength: tagMaxLength,
            },
          }}
        />
      )}
    />
  )
}

// The user's tags with how many cards have each, to show only one tag's cards. The tag that's picked can be renamed
// or deleted.
export function TagFilter({
  tags,
  counts,
  total,
  selected,
  busy,
  onSelect,
  onRename,
  onDelete,
}: {
  tags: Tag[]
  counts: Map<number, number>
  total: number
  selected: Tag | null
  busy: boolean
  onSelect: (tag: Tag | null) => void
  // Resolves to whether it was renamed, so the form only closes when it was.
  onRename: (tag: Tag, name: string) => Promise<boolean>
  onDelete: (tag: Tag) => void
}) {
  // The new name being typed for the picked tag, or null when it isn't being renamed.
  const [name, setName] = useState<string | null>(null)

  async function handleRename(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      selected !== null &&
      name !== null &&
      (await onRename(selected, name))
    ) {
      setName(null)
    }
  }

  function select(tag: Tag | null) {
    setName(null)
    onSelect(tag)
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Typography
        id="tag-filter-label"
        variant="subtitle2"
        color="text.secondary"
        sx={{ mb: 1 }}
      >
        Show cards tagged
      </Typography>
      <Box
        role="group"
        aria-labelledby="tag-filter-label"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        <Chip
          label={`All (${total})`}
          color={selected === null ? 'primary' : 'default'}
          variant={selected === null ? 'filled' : 'outlined'}
          aria-pressed={selected === null}
          onClick={() => select(null)}
        />
        {tags.map((tag) => (
          <Chip
            key={tag.id}
            label={`${tag.name} (${counts.get(tag.id) ?? 0})`}
            color={selected?.id === tag.id ? 'primary' : 'default'}
            variant={selected?.id === tag.id ? 'filled' : 'outlined'}
            aria-pressed={selected?.id === tag.id}
            onClick={() => select(tag)}
          />
        ))}
      </Box>
      {selected !== null &&
        (name === null ? (
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <Button
              type="button"
              size="small"
              disabled={busy}
              aria-label={`Rename tag "${selected.name}"`}
              onClick={() => setName(selected.name)}
            >
              Rename
            </Button>
            <Button
              type="button"
              size="small"
              color="error"
              disabled={busy}
              aria-label={`Delete tag "${selected.name}"`}
              onClick={() => onDelete(selected)}
            >
              Delete tag
            </Button>
          </Box>
        ) : (
          <TagRenameForm
            name={name}
            busy={busy}
            onChange={setName}
            onCancel={() => setName(null)}
            onSave={(event) => void handleRename(event)}
          />
        ))}
    </Box>
  )
}

// The form for a tag's new name. Like the card edit form, the field gets focus when the form appears.
function TagRenameForm({
  name,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  name: string
  busy: boolean
  onChange: (name: string) => void
  onCancel: () => void
  onSave: (event: SubmitEvent<HTMLFormElement>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <Box
      component="form"
      onSubmit={onSave}
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        gap: 1,
        // More than the buttons' gap, since the field's label sits on its top edge.
        mt: 2,
        alignItems: { xs: 'stretch', sm: 'center' },
      }}
    >
      <TextField
        label="Tag name"
        value={name}
        onChange={(event) => onChange(event.target.value)}
        inputRef={inputRef}
        slotProps={{ htmlInput: { maxLength: tagMaxLength } }}
        size="small"
      />
      <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
        <Button type="submit" variant="contained" size="small" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="small" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </Box>
    </Box>
  )
}
