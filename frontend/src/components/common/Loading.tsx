import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'

// A spinner for what's on its way, labelled for screen readers.
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
      <CircularProgress aria-label={label} />
    </Box>
  )
}
