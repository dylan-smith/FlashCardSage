import type { ReactNode } from 'react'
import Table from '@mui/material/Table'
import TableContainer from '@mui/material/TableContainer'

// A table that scrolls sideways when it's wider than the page, as it is on a phone. The scrolling region can be
// focused, so it can be scrolled from the keyboard too.
export function ScrollTable({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <TableContainer
      role="region"
      aria-label={`${label}, scrolls sideways`}
      tabIndex={0}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}
    >
      <Table
        size="small"
        aria-label={label}
        sx={{
          '& th': { whiteSpace: 'nowrap', fontWeight: 'bold' },
          // Less room between the columns than a table usually has, so more of them fit without scrolling.
          '& th, & td': { px: 1 },
        }}
      >
        {children}
      </Table>
    </TableContainer>
  )
}
