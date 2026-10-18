import type { ReactNode } from 'react'
import Box from '@mui/material/Box'

// One tab's content, hidden while another tab is showing. Its tab's id is `${group}-tab-${value}` and its
// aria-controls `${group}-panel-${value}`. A Box, since a Stack's display would show the panel while it's hidden.
export function TabPanel({
  group,
  value,
  current,
  children,
}: {
  group: string
  value: string
  current: string
  children: ReactNode
}) {
  return (
    <Box
      role="tabpanel"
      id={`${group}-panel-${value}`}
      aria-labelledby={`${group}-tab-${value}`}
      hidden={current !== value}
    >
      {children}
    </Box>
  )
}
