import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import { formatWords } from '../../api/flashCards'
import type { FlashCard } from '../../api/flashCards'
import type { SystemDeck } from '../../api/systemDecks'
import { cardCount } from '../../lib/cardCount'
import { AnimatedList, AnimatedListItem } from '../common/AnimatedList'
import { ChevronIcon } from '../common/ChevronIcon'
import { CardActionButton } from '../cards/CardActionButton'
import { FlashCardRow } from '../cards/FlashCardRow'

// The built-in decks, each with a button that adds it and a name that shows and hides its cards, which can be added
// one at a time. A card the user already has (one of the deck's ownedCardIds, or addedCardIds since the decks were
// loaded) says so instead, as does a deck's button once the user has all its cards, and its card count says how many
// they have. busyDeckId and busyCardId are what's being added, and busy disables every button.
export function SystemDeckList({
  decks,
  addedCardIds,
  busy,
  busyDeckId,
  busyCardId,
  onImport,
  onImportCard,
}: {
  decks: SystemDeck[]
  addedCardIds: number[]
  busy: boolean
  busyDeckId?: number
  busyCardId?: number
  onImport: (deck: SystemDeck) => void
  onImportCard: (deck: SystemDeck, card: FlashCard) => void
}) {
  // The decks whose cards are showing.
  const [shownIds, setShownIds] = useState<number[]>([])

  function toggleShown(id: number) {
    setShownIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )
  }

  return (
    <List disablePadding>
      {decks.map((deck) => {
        const shown = shownIds.includes(deck.id)
        const cardsId = `system-deck-${deck.id}-cards`
        const isAdded = (card: FlashCard) =>
          deck.ownedCardIds.includes(card.id) || addedCardIds.includes(card.id)
        const addedCount = deck.cards.filter(isAdded).length
        const allAdded =
          deck.cards.length > 0 && addedCount === deck.cards.length
        return (
          <ListItem
            key={deck.id}
            divider
            disablePadding
            sx={{ py: 1, display: 'block' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {/* The name shows and hides the deck's cards, with an arrow like the suggested cards' heading. */}
              <ListItemText
                primary={
                  <Button
                    type="button"
                    color="inherit"
                    aria-expanded={shown}
                    aria-controls={cardsId}
                    onClick={() => toggleShown(deck.id)}
                    endIcon={<ChevronIcon expanded={shown} />}
                    sx={{
                      font: 'inherit',
                      textTransform: 'none',
                      textAlign: 'left',
                      ml: -1,
                      px: 1,
                      py: 0,
                    }}
                  >
                    {deck.name}
                  </Button>
                }
                secondary={
                  allAdded
                    ? `${cardCount(deck.cards.length)}, all added`
                    : addedCount > 0
                      ? `${cardCount(deck.cards.length)}, ${addedCount} added`
                      : cardCount(deck.cards.length)
                }
                sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
              />
              <Button
                variant="contained"
                aria-label={`${allAdded ? 'Added' : 'Add'} deck "${deck.name}"`}
                disabled={busy || allAdded}
                onClick={() => onImport(deck)}
                sx={{ flexShrink: 0 }}
              >
                {busyDeckId === deck.id
                  ? 'Adding…'
                  : allAdded
                    ? 'Added'
                    : 'Add'}
              </Button>
            </Box>
            <Collapse in={shown} id={cardsId} unmountOnExit>
              {/* Laid out like the user's own cards, set in a little under the deck. */}
              <AnimatedList
                disablePadding
                aria-label={`Cards in "${deck.name}"`}
                // The deck's own divider is under the last card.
                sx={{
                  pl: 2,
                  '& > li:last-of-type .MuiListItem-root': {
                    borderBottom: 'none',
                  },
                }}
              >
                {deck.cards.map((card) => {
                  const added = isAdded(card)
                  return (
                    <AnimatedListItem key={card.id}>
                      <FlashCardRow
                        card={card}
                        actions={
                          <CardActionButton
                            icon="add"
                            text={added ? 'Added' : 'Add'}
                            label={`${added ? 'Added' : 'Add'} "${formatWords(card.spanish)}"`}
                            disabled={busy || added}
                            busyText={
                              busyCardId === card.id ? 'Adding…' : undefined
                            }
                            tooltip={
                              added
                                ? 'This card is already in your collection.'
                                : undefined
                            }
                            onClick={() => onImportCard(deck, card)}
                          />
                        }
                      />
                    </AnimatedListItem>
                  )
                })}
              </AnimatedList>
            </Collapse>
          </ListItem>
        )
      })}
    </List>
  )
}
