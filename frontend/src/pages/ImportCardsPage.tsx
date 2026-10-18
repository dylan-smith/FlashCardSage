import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
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
import { trackEvent, trackException } from '../telemetry'
import { useAction } from '../hooks/useAction'
import { useLoad } from '../hooks/useLoad'
import { EmptyText } from '../components/common/EmptyText'
import { Loading } from '../components/common/Loading'
import { Section } from '../components/common/Section'
import { TabPanel } from '../components/common/TabPanel'
import { showToast } from '../toasts'
import { cardCount, skippedSentence } from '../lib/cardCount'
import { getHandoff } from '../wordSources/handoff'
import { wordSourceFrom, wordSources } from '../wordSources/wordSources'
import type { WordSource } from '../wordSources/wordSources'
import { DocumentScan } from '../components/import/DocumentScan'
import { SystemDeckList } from '../components/import/SystemDeckList'
import { WebsiteImport } from '../components/import/WebsiteImport'

// What importing did, such as "Added Months with 12 cards." and how many were left out.
function describeImport({ deck, skippedCount }: SystemDeckImport) {
  const added = `Added ${deck.name} with ${cardCount(deck.flashCardIds.length)}.`
  if (skippedCount === 0) {
    return added
  }
  return `${added} ${skippedSentence(skippedCount)}`
}

// Where the cards come from: a built-in deck, a document the user picks, or a website they learn on.
type ImportTab = 'decks' | 'document' | 'website'

// The URL's from parameter is the tab, for each but the first, so a link, a refresh or the back button opens it, and
// its site parameter the website picked on the website tab. A site's "Send to FlashCardSage" bookmarklet opens the
// page this way (/import?from=website&site=<site id>).
function tabFrom(param: string | null): ImportTab {
  return param === 'document' || param === 'website' ? param : 'decks'
}

// The site to show when the URL doesn't say: the one whose words a bookmarklet has sent or is sending, such as when
// the user comes back to the page with them still here, or else the first.
function defaultSite(): WordSource {
  const handoff = getHandoff()
  return (
    (handoff.status !== 'none' ? wordSourceFrom(handoff.source) : null) ??
    wordSources[0]
  )
}

// The built-in decks the user can add to their own, cards made from a document they pick, and the words on a website
// they learn on, on tabs rather than one after the other, since each can be a long list. Adding a deck copies its
// cards and tags, so the user can change them like any of their cards.
function ImportCardsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = tabFrom(searchParams.get('from'))
  const site = wordSourceFrom(searchParams.get('site')) ?? defaultSite()
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
    setSearchParams(value === 'decks' ? {} : { from: value })
  }

  function pickSite(source: WordSource) {
    setSearchParams({ from: 'website', site: source.id })
  }

  // Every tab stays mounted, so a scan on its way or cards half looked over are still there after a look at the decks.
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
          value="website"
          label="From a website"
          id="import-tab-website"
          aria-controls="import-panel-website"
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
      <TabPanel group="import" value="website" current={tab}>
        <WebsiteImport
          picked={site}
          onPick={pickSite}
          active={tab === 'website'}
        />
      </TabPanel>
    </Section>
  )
}

export default ImportCardsPage
