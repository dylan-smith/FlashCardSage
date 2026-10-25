import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import { Link } from 'react-router'
import type { CardSelectionKind } from '../../hooks/useCardSelection'
import { EmptyText } from '../common/EmptyText'

// What a deck or a tag with no cards says.
const emptyMessages = {
  deck: 'There are no cards in this deck.',
  tag: 'There are no cards with this tag.',
}

// What practice or scores says when the cards picked are none, with a button to where cards are added: the decks
// for a deck, and the cards page otherwise. message, when given, is what it says instead, such as when there are too
// few cards.
export function EmptySelection({
  kind,
  noCardsMessage,
  message,
}: {
  kind: CardSelectionKind
  // What it says when the user has no cards at all.
  noCardsMessage: string
  message?: string
}) {
  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
      <EmptyText>
        {message ?? (kind === 'all' ? noCardsMessage : emptyMessages[kind])}
      </EmptyText>
      {kind === 'deck' ? (
        <Button component={Link} to="/decks" variant="contained">
          Edit decks
        </Button>
      ) : (
        <Button component={Link} to="/" variant="contained">
          {kind === 'tag' ? 'Manage cards' : 'Add flash cards'}
        </Button>
      )}
    </Stack>
  )
}
