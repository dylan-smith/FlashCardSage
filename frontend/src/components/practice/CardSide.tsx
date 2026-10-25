import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { PracticeSide } from '../../api/flashCards'
import { sides } from './sides'

// One side of the card: its words, unless they're to be heard rather than seen, with a button beside them when the
// side has one (Listen, for the Spanish). The words are h4 unless variant makes them smaller.
export function CardSide({
  side,
  text,
  action,
  variant = 'h4',
}: {
  side: PracticeSide
  text?: string
  action?: ReactNode
  variant?: 'h4' | 'h5'
}) {
  return (
    <Box>
      <Typography variant="overline" component="p" color="text.secondary">
        {side}
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'center' }}
      >
        {text !== undefined && (
          <Typography
            variant={variant}
            component="p"
            lang={sides[side].lang}
            sx={{ overflowWrap: 'anywhere', minWidth: 0 }}
          >
            {text}
          </Typography>
        )}
        {action}
      </Stack>
    </Box>
  )
}
