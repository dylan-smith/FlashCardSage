import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import SvgIcon from '@mui/material/SvgIcon'
import Tooltip from '@mui/material/Tooltip'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import { icons } from '../../lib/icons'

const iconColors = {
  add: 'success',
  edit: 'primary',
  delete: 'error',
  remove: 'primary',
} as const

// A button for one card in a list of cards. On a wide screen it's a text button, and on a phone, where the card's
// words need the room, it's an icon (a plus to add, a pencil to edit, a trash can to delete, a circle with a minus to
// remove) with the text as its tooltip. The label names the card, for screen readers. While it's busy, such as while
// the card is being added, the text button shows busyText ("Adding…") and the icon a spinner. A tooltip, such as why
// the button is disabled, shows on the text button too, and on the icon in place of the text.
export function CardActionButton({
  icon,
  text,
  label,
  disabled,
  busyText,
  tooltip,
  onClick,
}: {
  icon: keyof typeof iconColors
  text: string
  label: string
  disabled: boolean
  busyText?: string
  tooltip?: string
  onClick: () => void
}) {
  const busy = busyText !== undefined
  // Read straight away, since the app is only rendered in the browser, so a wide screen doesn't show icons first.
  const wide = useMediaQuery(useTheme().breakpoints.up('sm'), { noSsr: true })

  if (wide) {
    const button = (
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
    if (tooltip === undefined) {
      return button
    }
    return (
      <Tooltip title={tooltip} describeChild>
        {/* A disabled button gets no mouse events, so the tooltip listens on this instead. */}
        <span style={{ flexShrink: 0 }}>{button}</span>
      </Tooltip>
    )
  }

  return (
    <Tooltip title={tooltip ?? text} describeChild>
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
