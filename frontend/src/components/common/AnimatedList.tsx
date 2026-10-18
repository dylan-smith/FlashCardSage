import Collapse from '@mui/material/Collapse'
import type { CollapseProps } from '@mui/material/Collapse'
import List from '@mui/material/List'
import type { ListProps } from '@mui/material/List'
import { TransitionGroup } from 'react-transition-group'

// A list whose items collapse open when they're added and shut when they're removed, so the list grows and shrinks
// smoothly instead of jumping. Its children must be AnimatedListItems with stable keys: an item with a different
// key is a different item, so a row swapped for its edit form under another key shrinks away as the form grows.
// Give the list itself a key that changes with any filter on it, so filtering swaps the items at once rather than
// collapsing dozens of them together.
export function AnimatedList({ children, ...props }: ListProps) {
  return (
    <List {...props}>
      <TransitionGroup component={null}>{children}</TransitionGroup>
    </List>
  )
}

// One item of an AnimatedList. It's the list's <li>, so a ListItem inside it is rendered as a div (an <li> can't
// hold another). The collapse takes longer for a taller item, as a form is, and no time at all when the user has
// asked for less motion.
export function AnimatedListItem(props: CollapseProps) {
  return <Collapse component="li" timeout="auto" {...props} />
}
