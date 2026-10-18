import type { ReactNode } from 'react'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'

// A section of a page, on its own card, with the title as its heading.
export function Section({
  title,
  sx,
  children,
}: {
  title?: string
  // More styles, such as less padding at the top above tabs.
  sx?: Exclude<SxProps<Theme>, readonly unknown[]>
  children: ReactNode
}) {
  return (
    <Paper component="section" elevation={2} sx={[{ p: 3 }, sx ?? false]}>
      {title !== undefined && (
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          {title}
        </Typography>
      )}
      {children}
    </Paper>
  )
}
