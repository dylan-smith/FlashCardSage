import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import SvgIcon from '@mui/material/SvgIcon'
import Tooltip from '@mui/material/Tooltip'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'

// The Material icons' paths, so the icons need no package of their own.
const icons = {
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  delete:
    'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z',
  remove:
    'M7 11v2h10v-2zm5-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8',
}

const iconColors = {
  add: 'success',
  edit: 'primary',
  delete: 'error',
  remove: 'primary',
} as const

// A button for one card in a list of cards. On a wide screen it's a text button, and on a phone, where the card's
// words need the room, it's an icon (a plus to add, a pencil to edit, a trash can to delete, a circle with a minus to
// remove) with the text as its tooltip. The label names the card, for screen readers. While it's busy, such as while
// the card is being added, the text button shows busyText ("Adding…") and the icon a spinner.
export function CardActionButton({
  icon,
  text,
  label,
  disabled,
  busyText,
  onClick,
}: {
  icon: keyof typeof icons
  text: string
  label: string
  disabled: boolean
  busyText?: string
  onClick: () => void
}) {
  const busy = busyText !== undefined
  // Read straight away, since the app is only rendered in the browser, so a wide screen doesn't show icons first.
  const wide = useMediaQuery(useTheme().breakpoints.up('sm'), { noSsr: true })

  if (wide) {
    return (
      <Button
        type="button"
        size="small"
        color={icon === 'delete' ? 'error' : 'primary'}
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
        sx={{ flexShrink: 0 }}
      >
        {busyText ?? text}
      </Button>
    )
  }

  return (
    <Tooltip title={text} describeChild>
      {/* A disabled button gets no mouse events, so the tooltip listens on this instead. */}
      <span style={{ flexShrink: 0 }}>
        <IconButton
          size="small"
          color={iconColors[icon]}
          disabled={disabled}
          aria-label={label}
          aria-busy={busy}
          onClick={onClick}
        >
          {busy ? (
            <CircularProgress size={20} color="inherit" />
          ) : (
            <SvgIcon fontSize="small">
              <path d={icons[icon]} />
            </SvgIcon>
          )}
        </IconButton>
      </span>
    </Tooltip>
  )
}
