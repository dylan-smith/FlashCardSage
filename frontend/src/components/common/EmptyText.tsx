import type { ReactNode } from 'react'
import Typography from '@mui/material/Typography'

// What a list says when there's nothing in it.
export function EmptyText({ children }: { children: ReactNode }) {
  return <Typography color="text.secondary">{children}</Typography>
}
