import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import { useSearchParams } from 'react-router'
import { formatWords } from '../api/flashCards'
import type { FlashCard } from '../api/flashCards'
import {
  importSystemDeck,
  importSystemDeckCard,
  listSystemDecks,
} from '../api/systemDecks'
import type { SystemDeck, SystemDeckImport } from '../api/systemDecks'
import { preplyTabParam } from '../preply/preplyHandoff'
import { trackEvent, trackException } from '../telemetry'
import { useAction } from '../hooks/useAction'
import { useLoad } from '../hooks/useLoad'
import { ChevronIcon } from '../components/common/ChevronIcon'
import { EmptyText } from '../components/common/EmptyText'
import { Loading } from '../components/common/Loading'
import { Section } from '../components/common/Section'
import { TabPanel } from '../components/common/TabPanel'
import { showToast } from '../toasts'
import {
  AnimatedList,
  AnimatedListItem,
} from '../components/common/AnimatedList'
import { CardActionButton } from '../components/cards/CardActionButton'
import { cardCount } from '../lib/cardCount'
import { DocumentScan } from '../components/import/DocumentScan'
import { FlashCardRow } from '../components/cards/FlashCardRow'
import { PreplyImport } from '../components/import/PreplyImport'

// What importing did, such as "Added Months with 12 cards." and how many were left out.
function describeImport({ deck, skippedCount }: SystemDeckImport) {
  const added = `Added ${deck.name} with ${cardCount(deck.flashCardIds.length)}.`
  if (skippedCount === 0) {
    return added
  }
  return `${added} ${skippedCount === 1 ? '1 card was' : `${skippedCount} cards were`} left out because you already have ${skippedCount === 1 ? 'it' : 'them'}.`
}

// Where the cards come from: a built-in deck, a document the user picks, or their Preply vocabulary.
type ImportTab = 'decks' | 'document' | 'preply'

// The URL's from parameter for each tab but the first, so a link, a refresh or the back button opens it. The
// "Send to FlashCardSage" bookmarklet opens the Preply tab this way.
const documentTabParam = 'document'

function tabFrom(param: string | null): ImportTab {
  if (param === documentTabParam) {
    return 'document'
  }
  return param === preplyTabParam ? 'preply' : 'decks'
}

// The built-in decks the user can add to their own, cards made from a document they pick, and the words in their
// Preply vocabulary, on tabs rather than one after the other, since each can be a long list. Adding a deck copies its
// cards and tags, so the user can change them like any of their cards.
function ImportCardsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = tabFrom(searchParams.get('from'))
  const [errorMessage, setErrorMessage] = useState('')
  const {
    data: decks,
    setData: setDecks,
    loading,
    failed: loadFailed,
  } = useLoad(() => listSystemDecks(), [], {
    operation: 'load',
    fallback: 'Unable to load the built-in decks.',
    onError: setErrorMessage,
    initial: [] as SystemDeck[],
  })
  // The decks whose cards are showing.
  const [shownIds, setShownIds] = useState<number[]>([])
  // The deck being added, so its button can wait for the API.
  const importingDeck = useAction<number>(setErrorMessage)
  const busyId = importingDeck.busyKey
  // The built-in card being added on its own, and the ones added since the decks were loaded, which the user has now
  // like the decks' owned cards.
  const importingCard = useAction<number>(setErrorMessage)
  const busyCardId = importingCard.busyKey
  const [addedCardIds, setAddedCardIds] = useState<number[]>([])
  const busy = importingDeck.busy || importingCard.busy

  // Loads the decks again after cards are added, so every card the user now has a word of says so, such as all of a
  // deck's after adding the deck. The page already shows the decks, so a failure only leaves them as they were.
  function refreshDecks() {
    listSystemDecks()
      .then(setDecks)
      .catch((error: unknown) => {
        trackException(error, { operation: 'refresh' })
      })
  }

  function toggleShown(id: number) {
    setShownIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )
  }

  // A 409 for a deck the user already has all the cards of is theirs to see, not a failure.
  async function handleImport(deck: SystemDeck) {
    await importingDeck.run(
      {
        operation: 'import',
        fallback: 'Unable to add the deck.',
        key: deck.id,
      },
      async () => {
        const result = await importSystemDeck(deck.id)
        trackEvent('SystemDeckImported')
        refreshDecks()
        showToast({
          key: 'system-deck-imported',
          severity: 'success',
          message: describeImport(result),
          action: { label: 'Open deck', to: `/decks/${result.deck.id}` },
        })
      },
    )
  }

  // Adds just this card, to the user's deck with the built-in deck's name, which the API makes if they haven't got it.
  // A 409 for a card the user already has is theirs to see too.
  async function handleImportCard(deck: SystemDeck, card: FlashCard) {
    await importingCard.run(
      {
        operation: 'import card',
        fallback: 'Unable to add the card.',
        key: card.id,
      },
      async () => {
        const result = await importSystemDeckCard(deck.id, card.id)
        trackEvent('SystemDeckCardImported')
        setAddedCardIds((current) => [...current, card.id])
        refreshDecks()
        showToast({
          key: 'system-deck-card-imported',
          severity: 'success',
          message: `Added "${formatWords(card.spanish)}" to ${result.deckCreated ? 'a new deck, ' : ''}${result.deck.name}.`,
          action: { label: 'Open deck', to: `/decks/${result.deck.id}` },
        })
      },
    )
  }

  function selectTab(value: ImportTab) {
    setSearchParams(
      value === 'document'
        ? { from: documentTabParam }
        : value === 'preply'
          ? { from: preplyTabParam }
          : {},
    )
  }

  // Both tabs stay mounted, so a scan on its way or cards half looked over are still there after a look at the decks.
  return (
    <Section sx={{ pt: 1 }}>
      <Tabs
        value={tab}
        onChange={(_event, value: ImportTab) => selectTab(value)}
        aria-label="Import cards from"
        variant="fullWidth"
        sx={{ mb: 2 }}
      >
        <Tab
          value="decks"
          label="Built-in decks"
          id="import-tab-decks"
          aria-controls="import-panel-decks"
        />
        <Tab
          value="document"
          label="From a document"
          id="import-tab-document"
          aria-controls="import-panel-document"
        />
        <Tab
          value="preply"
          label="From Preply"
          id="import-tab-preply"
          aria-controls="import-panel-preply"
        />
      </Tabs>
      <TabPanel group="import" value="decks" current={tab}>
        <Stack spacing={2}>
          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

          <Box>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Add a deck to get its cards and tags, or open it to add just some
              of its cards. They&apos;re then yours to change. Cards you already
              have are left out.
            </Typography>
            {loading ? (
              <Loading />
            ) : loadFailed ? null : decks.length === 0 ? (
              <EmptyText>There aren&apos;t any built-in decks yet.</EmptyText>
            ) : (
              <List disablePadding>
                {decks.map((deck) => {
                  const shown = shownIds.includes(deck.id)
                  const cardsId = `system-deck-${deck.id}-cards`
                  return (
                    <ListItem
                      key={deck.id}
                      divider
                      disablePadding
                      sx={{ py: 1, display: 'block' }}
                    >
                      <Box
                        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                      >
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
                          secondary={cardCount(deck.cards.length)}
                          sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                        />
                        <Button
                          variant="contained"
                          aria-label={`Add deck "${deck.name}"`}
                          disabled={busy}
                          onClick={() => void handleImport(deck)}
                          sx={{ flexShrink: 0 }}
                        >
                          {busyId === deck.id ? 'Adding…' : 'Add'}
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
                            const added =
                              deck.ownedCardIds.includes(card.id) ||
                              addedCardIds.includes(card.id)
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
                                        busyCardId === card.id
                                          ? 'Adding…'
                                          : undefined
                                      }
                                      tooltip={
                                        added
                                          ? 'This card is already in your collection.'
                                          : undefined
                                      }
                                      onClick={() =>
                                        void handleImportCard(deck, card)
                                      }
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
            )}
          </Box>
        </Stack>
      </TabPanel>
      <TabPanel group="import" value="document" current={tab}>
        <DocumentScan />
      </TabPanel>
      <TabPanel group="import" value="preply" current={tab}>
        <PreplyImport active={tab === 'preply'} />
      </TabPanel>
    </Section>
  )
}

export default ImportCardsPage
