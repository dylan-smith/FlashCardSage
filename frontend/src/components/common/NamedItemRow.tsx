import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import { Link as RouterLink } from 'react-router'

// One named thing in a list, such as a deck or a tag: its name, linking to its cards, a line under it, such as how
// many cards it has, and its buttons at the end. It goes inside an AnimatedListItem, which is the list's <li>.
export function NamedItemRow({
  name,
  to,
  secondary,
  children,
}: {
  name: string
  // Where the name links to.
  to: string
  secondary: string
  // The buttons.
  children: ReactNode
}) {
  return (
    <ListItem component="div" divider disablePadding sx={{ py: 1, gap: 1 }}>
      {/* The name wraps rather than the buttons, so they stay together on a phone. */}
      <ListItemText
        primary={
          <Link component={RouterLink} to={to}>
            {name}
          </Link>
        }
        secondary={secondary}
        sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
      />
      <Box sx={{ display: 'flex', flexShrink: 0 }}>{children}</Box>
    </ListItem>
  )
}
