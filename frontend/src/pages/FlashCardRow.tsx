import { useId } from 'react'
import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import type { FlashCard } from '../api/flashCards'
import { thumbnailSize } from './FlashCardPicture'

// One card in a list of cards to pick from, laid out the same wherever one is shown: a box to pick it, its picture
// if it has one, its Spanish and English and its tags, and any buttons for it at the end.
export function FlashCardRow({
  card,
  picked,
  onPick,
  actions,
}: {
  card: FlashCard
  picked: boolean
  onPick: () => void
  actions?: ReactNode
}) {
  const checkboxId = useId()

  return (
    <ListItem divider disablePadding sx={{ py: 1, gap: 1 }}>
      <Checkbox
        id={checkboxId}
        checked={picked}
        onChange={onPick}
        slotProps={{ input: { 'aria-label': `Pick "${card.spanish}"` } }}
        sx={{ flexShrink: 0, alignSelf: 'flex-start', ml: -1.5 }}
      />
      {/* Clicking the card's picture or words picks it too, which helps when picking a lot of cards. */}
      <Box
        component="label"
        htmlFor={checkboxId}
        sx={{
          display: 'flex',
          gap: 1,
          flexGrow: 1,
          minWidth: 0,
          cursor: 'pointer',
        }}
      >
        {card.imageUrl !== null && (
          <Box
            component="img"
            src={card.imageUrl}
            alt={`Picture for "${card.spanish}"`}
            loading="lazy"
            sx={{
              // Smaller on a phone, so the card's words keep room next to the pick box and buttons.
              width: { xs: thumbnailSize / 2, sm: thumbnailSize },
              height: { xs: thumbnailSize / 2, sm: thumbnailSize },
              objectFit: 'cover',
              borderRadius: 1,
              flexShrink: 0,
            }}
          />
        )}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <ListItemText
            primary={card.spanish}
            secondary={card.english}
            sx={{ overflowWrap: 'anywhere' }}
          />
          {card.tags.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
              {card.tags.map((tag) => (
                <Chip key={tag.id} label={tag.name} size="small" />
              ))}
            </Box>
          )}
        </Box>
      </Box>
      {actions}
    </ListItem>
  )
}
