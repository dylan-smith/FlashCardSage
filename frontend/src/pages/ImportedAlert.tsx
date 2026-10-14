import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import { Link as RouterLink } from 'react-router'
import type { DeckImport } from '../api/decks'
import { cardCount } from './cardCount'

// What importing did, such as "Added Months with 12 cards." and how many were left out.
function describeImport({ deck, skippedCount }: DeckImport) {
  const added = `Added ${deck.name} with ${cardCount(deck.flashCardIds.length)}.`
  if (skippedCount === 0) {
    return added
  }
  return `${added} ${skippedCount === 1 ? '1 card was' : `${skippedCount} cards were`} left out because you already have ${skippedCount === 1 ? 'it' : 'them'}.`
}

// Says what importing did, with a link to the new deck.
export function ImportedAlert({ imported }: { imported: DeckImport }) {
  return (
    <Alert
      severity="success"
      action={
        <Button
          component={RouterLink}
          to={`/decks/${imported.deck.id}`}
          color="inherit"
          size="small"
        >
          Open deck
        </Button>
      }
    >
      {describeImport(imported)}
    </Alert>
  )
}
