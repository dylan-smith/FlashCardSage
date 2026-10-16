import Button from '@mui/material/Button'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'

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
        endIcon={
          <SvgIcon
            sx={{
              transform: collapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform 150ms',
            }}
          >
            <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
          </SvgIcon>
        }
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
