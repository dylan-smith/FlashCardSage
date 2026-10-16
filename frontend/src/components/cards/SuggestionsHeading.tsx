import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { ChevronIcon } from '../common/ChevronIcon'

// A suggestions section's heading, as a button that collapses and expands the content with the id controls, with a
// chevron that turns to show which.
export function SuggestionsHeading({
  title,
  collapsed,
  controls,
  onToggle,
}: {
  title: string
  collapsed: boolean
  controls: string
  onToggle: () => void
}) {
  return (
    <Typography variant="h5" component="h2">
      <Button
        type="button"
        color="inherit"
        aria-expanded={!collapsed}
        aria-controls={controls}
        onClick={onToggle}
        endIcon={<ChevronIcon expanded={!collapsed} />}
        sx={{
          font: 'inherit',
          textTransform: 'none',
          ml: -1,
          px: 1,
          '& .MuiButton-endIcon > svg': { fontSize: 28 },
        }}
      >
        {title}
      </Button>
    </Typography>
  )
}
