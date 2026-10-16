import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import type { CardSelectionChoices } from '../hooks/useCardSelection'

type CardSelectionPickerProps = {
  label: string
  choices: CardSelectionChoices | null
  value: string
  onSelect: (value: string) => void
}

// Picks every card, a deck or a tag. Left out until the decks and tags have loaded, and when there are none.
function CardSelectionPicker({
  label,
  choices,
  value,
  onSelect,
}: CardSelectionPickerProps) {
  if (
    choices === null ||
    (choices.decks.length === 0 && choices.tags.length === 0)
  ) {
    return null
  }

  return (
    // Each option says whether it's a deck or a tag. MUI's Select makes every child an option, so group headings
    // would be read out as options too.
    <TextField
      select
      label={label}
      size="small"
      value={value}
      onChange={(event) => onSelect(event.target.value)}
      sx={{ minWidth: 220, alignSelf: 'flex-start' }}
    >
      <MenuItem value="all">All cards</MenuItem>
      {choices.decks.map((item) => (
        <MenuItem key={`deck-${item.id}`} value={`deck-${item.id}`}>
          Deck: {item.name}
        </MenuItem>
      ))}
      {choices.tags.map((item) => (
        <MenuItem key={`tag-${item.id}`} value={`tag-${item.id}`}>
          Tag: {item.name}
        </MenuItem>
      ))}
    </TextField>
  )
}

export default CardSelectionPicker
