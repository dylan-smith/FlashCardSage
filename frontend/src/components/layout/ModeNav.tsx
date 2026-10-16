import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { Link } from 'react-router'
import { modes } from './nav'
import type { NavMode } from './nav'

// The app's modes, with the one the user is in (if any) picked out.
export function ModeNav({ current }: { current: NavMode | undefined }) {
  return (
    <Box
      component="nav"
      aria-label="Mode"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 1,
        mb: 3,
      }}
    >
      {modes.map((mode) => {
        const active = mode === current
        return (
          <Button
            key={mode.to}
            component={Link}
            to={mode.to}
            // A mode with sections is where the user is, and the section's link is the page they're on.
            aria-current={
              active ? (mode.sections ? 'true' : 'page') : undefined
            }
            variant={active ? 'contained' : 'outlined'}
          >
            {mode.label}
          </Button>
        )
      })}
    </Box>
  )
}
