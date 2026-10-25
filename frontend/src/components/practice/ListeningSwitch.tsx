import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'

// Turns listening mode on or off, in the session's header for cards and sentences alike. Described by
// ListeningDescription, which goes below the header.
export function ListeningSwitch({
  listening,
  onChange,
}: {
  listening: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <FormControlLabel
      label="Listening mode"
      control={
        <Switch
          checked={listening}
          onChange={(event) => onChange(event.target.checked)}
          slotProps={{
            input: { 'aria-describedby': 'listening-description' },
          }}
        />
      }
    />
  )
}

// What listening mode does, or that it's off while offline, since the audio comes from the API.
export function ListeningDescription({
  listening,
  online,
}: {
  listening: boolean
  online: boolean
}) {
  return (
    <Typography
      id="listening-description"
      variant="body2"
      color="text.secondary"
    >
      {listening && !online
        ? "Listening mode is off while you're offline."
        : 'Hear the Spanish before you see it.'}
    </Typography>
  )
}
