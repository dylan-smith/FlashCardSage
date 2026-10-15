import { useEffect, useRef } from 'react'
import type { SubmitEvent } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { Tag } from '../api/flashCards'

// The most a tag name can be, as the API allows.
export const tagMaxLength = 50

// Picks a card's tags by name from the user's tags, or makes a new one by typing a name. The typed name is added on
// Enter, and when the field loses focus, so clicking Save straight after typing keeps it. Suggested tags show under
// the field, like a translated word's other meanings, and are added with a click. While they're being looked for, a
// spinner shows there instead.
export function TagsInput({
  value,
  tags,
  onChange,
  suggestions = [],
  suggesting = false,
  size,
}: {
  value: string[]
  tags: Tag[]
  onChange: (names: string[]) => void
  suggestions?: string[]
  suggesting?: boolean
  size?: 'small'
}) {
  const note = suggesting ? (
    <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <CircularProgress size={12} aria-hidden />
      Suggesting tags…
    </Box>
  ) : suggestions.length === 0 ? undefined : (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.5,
      }}
    >
      Suggested tags:
      {suggestions.map((name) => (
        <Chip
          key={name}
          label={name}
          size="small"
          variant="outlined"
          aria-label={`Add tag ${name}`}
          onClick={() => onChange([...value, name])}
        />
      ))}
    </Box>
  )

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
          helperText={note}
          slotProps={{
            ...params.slotProps,
            htmlInput: {
              ...params.slotProps.htmlInput,
              maxLength: tagMaxLength,
            },
            // A div, since it holds the suggestions' chips.
            formHelperText: { component: 'div' },
          }}
        />
      )}
    />
  )
}

// The user's tags with how many cards have each, to show only one tag's cards. Tags are renamed and deleted on the
// Tags page.
export function TagFilter({
  tags,
  counts,
  total,
  selected,
  onSelect: select,
}: {
  tags: Tag[]
  counts: Map<number, number>
  total: number
  selected: Tag | null
  onSelect: (tag: Tag | null) => void
}) {
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
    </Box>
  )
}

// The form for a tag's new name, used on the Tags page and for a deck's name too. Like the card edit form, the field gets focus when the form
// appears.
export function TagRenameForm({
  name,
  busy,
  onChange,
  onCancel,
  onSave,
  label = 'Tag name',
  maxLength = tagMaxLength,
}: {
  name: string
  busy: boolean
  onChange: (name: string) => void
  onCancel: () => void
  onSave: (event: SubmitEvent<HTMLFormElement>) => void
  label?: string
  maxLength?: number
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
        label={label}
        value={name}
        onChange={(event) => onChange(event.target.value)}
        inputRef={inputRef}
        slotProps={{ htmlInput: { maxLength } }}
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
