import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useSearchParams } from 'react-router'
import { formatWords } from '../api/flashCards'
import type { FlashCard } from '../api/flashCards'
import {
  importSystemDeck,
  importSystemDeckCard,
  listSystemDecks,
} from '../api/systemDecks'
import type { SystemDeck, SystemDeckImport } from '../api/systemDecks'
import { trackEvent, trackException } from '../telemetry'
import { useAction } from '../hooks/useAction'
import { useLoad } from '../hooks/useLoad'
import { EmptyText } from '../components/common/EmptyText'
import { Loading } from '../components/common/Loading'
import { Section } from '../components/common/Section'
import { TabPanel } from '../components/common/TabPanel'
import { showToast } from '../toasts'
import { cardCount, skippedSentence } from '../lib/cardCount'
import { wordSourceFrom, wordSources } from '../wordSources/wordSources'
import type { WordSourceId } from '../wordSources/wordSources'
import { DocumentScan } from '../components/import/DocumentScan'
import { SystemDeckList } from '../components/import/SystemDeckList'
import { WordSourceImport } from '../components/import/WordSourceImport'

// What importing did, such as "Added Months with 12 cards." and how many were left out.
function describeImport({ deck, skippedCount }: SystemDeckImport) {
  const added = `Added ${deck.name} with ${cardCount(deck.flashCardIds.length)}.`
  if (skippedCount === 0) {
    return added
  }
  return `${added} ${skippedSentence(skippedCount)}`
}

// Where the cards come from: a built-in deck, a document the user picks, or their words on a site they learn on.
type ImportTab = 'decks' | 'document' | WordSourceId

// The URL's from parameter for each tab but the first, so a link, a refresh or the back button opens it. A site's
// "Send to FlashCardSage" bookmarklet opens the site's tab this way, with the site's id.
const documentTabParam = 'document'

function tabFrom(param: string | null): ImportTab {
  if (param === documentTabParam) {
    return 'document'
  }
  return wordSourceFrom(param)?.id ?? 'decks'
}

// The built-in decks the user can add to their own, cards made from a document they pick, and the words on each site
// they learn on, on tabs rather than one after the other, since each can be a long list. Adding a deck copies its
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
  // The deck being added, so its button can wait for the API.
  const importingDeck = useAction<number>(setErrorMessage)
  // The built-in card being added on its own, and the ones added since the decks were loaded, which the user has now
  // like the decks' owned cards.
  const importingCard = useAction<number>(setErrorMessage)
  const [addedCardIds, setAddedCardIds] = useState<number[]>([])
  const busy = importingDeck.busy || importingCard.busy
  // Four tabs spelled out don't fit across a phone, so there each is just where the cards come from. Read straight
  // away, since the app is only rendered in the browser, so a wide screen doesn't show the short labels first.
  const wide = useMediaQuery(useTheme().breakpoints.up('sm'), { noSsr: true })

  // Loads the decks again after cards are added, so every card the user now has a word of says so, such as all of a
  // deck's after adding the deck. The page already shows the decks, so a failure only leaves them as they were.
  function refreshDecks() {
    listSystemDecks()
      .then(setDecks)
      .catch((error: unknown) => {
        trackException(error, { operation: 'refresh' })
      })
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
        : value === 'decks'
          ? {}
          : { from: value },
    )
  }

  // Every tab stays mounted, so a scan on its way or cards half looked over are still there after a look at the decks.
  return (
    <Section sx={{ pt: 1 }}>
      <Tabs
        value={tab}
        onChange={(_event, value: ImportTab) => selectTab(value)}
        aria-label="Import cards from"
        variant="fullWidth"
        // Even the short labels need less than a tab's usual least width and padding to share a phone's width.
        sx={{
          mb: 2,
          '& .MuiTab-root': {
            minWidth: { xs: 0, sm: 90 },
            px: { xs: 1, sm: 2 },
          },
        }}
      >
        {/* Each tab's full name is its label for a screen reader, whatever it shows. */}
        <Tab
          value="decks"
          label={wide ? 'Built-in decks' : 'Built-in'}
          aria-label="Built-in decks"
          id="import-tab-decks"
          aria-controls="import-panel-decks"
        />
        <Tab
          value="document"
          label={wide ? 'From a document' : 'Document'}
          aria-label="From a document"
          id="import-tab-document"
          aria-controls="import-panel-document"
        />
        {wordSources.map((source) => (
          <Tab
            key={source.id}
            value={source.id}
            label={wide ? `From ${source.name}` : source.name}
            aria-label={`From ${source.name}`}
            id={`import-tab-${source.id}`}
            aria-controls={`import-panel-${source.id}`}
          />
        ))}
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
              <SystemDeckList
                decks={decks}
                addedCardIds={addedCardIds}
                busy={busy}
                busyDeckId={importingDeck.busyKey}
                busyCardId={importingCard.busyKey}
                onImport={(deck) => void handleImport(deck)}
                onImportCard={(deck, card) => void handleImportCard(deck, card)}
              />
            )}
          </Box>
        </Stack>
      </TabPanel>
      <TabPanel group="import" value="document" current={tab}>
        <DocumentScan />
      </TabPanel>
      {wordSources.map((source) => (
        <TabPanel
          key={source.id}
          group="import"
          value={source.id}
          current={tab}
        >
          <WordSourceImport source={source} active={tab === source.id} />
        </TabPanel>
      ))}
    </Section>
  )
}

export default ImportCardsPage
