import type { SubmitEvent } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'

// The form that makes something new from just a name, such as a deck or a tag: the name's field and the button that
// makes it, side by side on a wide screen.
export function NameForm({
  id,
  label,
  placeholder,
  maxLength,
  value,
  busy,
  submitText,
  onChange,
  onSubmit,
}: {
  id: string
  label: string
  placeholder: string
  maxLength: number
  value: string
  busy: boolean
  // The button's text, such as "Create deck".
  submitText: string
  onChange: (value: string) => void
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void
}) {
  return (
    <Box
      component="form"
      onSubmit={onSubmit}
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'flex-start' },
        gap: 2,
      }}
    >
      <TextField
        id={id}
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{ htmlInput: { maxLength } }}
        required
        placeholder={placeholder}
        sx={{ flexGrow: 1 }}
      />
      <Button
        type="submit"
        variant="contained"
        disabled={busy}
        sx={{ flexShrink: 0, alignSelf: { sm: 'center' } }}
      >
        {busy ? 'Saving…' : submitText}
      </Button>
    </Box>
  )
}
