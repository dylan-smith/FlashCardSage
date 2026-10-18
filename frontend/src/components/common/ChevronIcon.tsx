import SvgIcon from '@mui/material/SvgIcon'
import { icons } from '../../lib/icons'

// A down arrow for a button that shows and hides something, turned to point right while it's hidden.
export function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <SvgIcon
      sx={{
        transform: expanded ? 'none' : 'rotate(-90deg)',
        transition: 'transform 150ms',
      }}
    >
      <path d={icons.expandMore} />
    </SvgIcon>
  )
}
