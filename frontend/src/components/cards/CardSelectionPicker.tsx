import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import type {
  CardSelection,
  CardSelectionChoices,
} from '../../hooks/useCardSelection'

type CardSelectionPickerProps = {
  label: string
  choices: CardSelectionChoices | null
  // The picked option's value, from useCardSelection.
  value: string
  onSelect: (selection: CardSelection) => void
}

// Picks every card, a deck or a tag. Left out until the decks and tags have loaded, and when there are none.
export function CardSelectionPicker({
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

  const options: { value: string; label: string; selection: CardSelection }[] =
    [
      { value: 'all', label: 'All cards', selection: { kind: 'all' } },
      ...choices.decks.map((item) => ({
        value: `deck-${item.id}`,
        label: `Deck: ${item.name}`,
        selection: { kind: 'deck' as const, id: item.id },
      })),
      ...choices.tags.map((item) => ({
        value: `tag-${item.id}`,
        label: `Tag: ${item.name}`,
        selection: { kind: 'tag' as const, id: item.id },
      })),
    ]

  return (
    // Each option says whether it's a deck or a tag. MUI's Select makes every child an option, so group headings
    // would be read out as options too.
    <TextField
      select
      label={label}
      size="small"
      value={value}
      onChange={(event) => {
        const picked = options.find(
          (option) => option.value === event.target.value,
        )
        if (picked) {
          onSelect(picked.selection)
        }
      }}
      sx={{ minWidth: 220, alignSelf: 'flex-start' }}
    >
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  )
}
