import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link, useParams } from 'react-router'
import { getAdminUser, listAdminUserCards } from '../../api/admin'
import type {
  AdminCard,
  AdminPracticeSummary,
  AdminUserDetail,
} from '../../api/admin'
import { formatWords } from '../../api/flashCards'
import type { PracticeOutcome } from '../../api/flashCards'
import { appName } from '../../api/oauth'
import { useLoad } from '../../hooks/useLoad'
import {
  formatDate,
  formatDateTime,
  formatDay,
  formatScore,
  sourceLabel,
  userName,
} from '../../lib/adminFormat'
import { matchesSearch } from '../../lib/cardSearch'
import { EmptyText } from '../../components/common/EmptyText'
import { Loading } from '../../components/common/Loading'
import { Section } from '../../components/common/Section'
import { ScrollTable } from '../../components/admin/ScrollTable'
import { StatTiles } from '../../components/admin/StatTiles'
import NotFoundPage from '../NotFoundPage'

const outcomeLabels: Record<PracticeOutcome, string> = {
  GotIt: 'Got it',
  WasClose: 'Close',
  Failed: 'Failed',
}

const preferenceLabels = {
  showPictures: 'Show pictures',
  showSuggestions: 'Suggest cards',
  autoTranslate: 'Translate automatically',
} as const

// Whether the card has the search in its words, tags, decks or source, whatever its accents and case.
function matchesCard(card: AdminCard, search: string) {
  return matchesSearch(
    {
      spanish: card.spanish,
      english: [
        ...card.english,
        ...card.tags,
        ...card.decks,
        sourceLabel(card.source),
      ],
    },
    search,
  )
}

// Terms and what they are, one to a line, such as a user's email and when they signed up.
function Details({ items }: { items: [string, string][] }) {
  return (
    <Box
      component="dl"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr',
        columnGap: 2,
        rowGap: 0.5,
        m: 0,
        '& dd': { m: 0, overflowWrap: 'anywhere' },
        '& dt': { color: 'text.secondary' },
      }}
    >
      {items.map(([term, value]) => (
        <Box key={term} sx={{ display: 'contents' }}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </Box>
      ))}
    </Box>
  )
}

function Profile({ detail }: { detail: AdminUserDetail }) {
  const { user, preferences } = detail
  return (
    <Section title={userName(user)}>
      <Details
        items={[
          ['Email', user.email ?? 'None'],
          ['Sign-in', user.subject],
          ['Signed up', formatDateTime(user.createdAt)],
          ['Last seen', formatDateTime(user.lastSeenAt)],
          ['Cards', String(user.cards)],
          ['Score', formatScore(user)],
          ['Decks', String(user.decks)],
          ['Tags', String(user.tags)],
          ...Object.entries(preferenceLabels).map(
            ([key, label]): [string, string] => [
              label,
              preferences[key as keyof typeof preferenceLabels] ? 'On' : 'Off',
            ],
          ),
        ]}
      />
    </Section>
  )
}

function Practice({ practice }: { practice: AdminPracticeSummary }) {
  return (
    <Section title="Practice">
      <StatTiles
        stats={[
          { label: 'Got it', value: practice.gotIt },
          { label: 'Close', value: practice.wasClose },
          { label: 'Failed', value: practice.failed },
          {
            label: 'First practiced',
            value: formatDate(practice.firstPracticedAt, 'Never'),
          },
          {
            label: 'Last practiced',
            value: formatDate(practice.lastPracticedAt, 'Never'),
          },
        ]}
      />
      <Typography variant="h6" component="h3" sx={{ mt: 3, mb: 1 }}>
        Last 30 days
      </Typography>
      <Box
        component="ul"
        aria-label="Practice results by day"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 0.5,
          listStyle: 'none',
          p: 0,
          m: 0,
        }}
      >
        {practice.byDay.map((day) => (
          <Box
            component="li"
            key={day.date}
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 1,
              px: 1,
              borderRadius: 1,
              bgcolor: day.results > 0 ? 'action.selected' : undefined,
              color: day.results > 0 ? undefined : 'text.secondary',
            }}
          >
            <span>{formatDay(day.date)}</span>
            <span>{day.results}</span>
          </Box>
        ))}
      </Box>
      <Typography variant="h6" component="h3" sx={{ mt: 3, mb: 1 }}>
        Recent results
      </Typography>
      {practice.recent.length === 0 ? (
        <EmptyText>No practice yet.</EmptyText>
      ) : (
        <List disablePadding dense aria-label="Recent results">
          {practice.recent.map((result, index) => (
            <ListItem
              key={`${result.practicedAt}-${index}`}
              divider
              disablePadding
              sx={{ py: 0.5, gap: 2 }}
            >
              <ListItemText
                primary={formatWords(result.spanish)}
                secondary={formatDateTime(result.practicedAt)}
                slotProps={{ primary: { lang: 'es' } }}
                sx={{ overflowWrap: 'anywhere' }}
              />
              <Typography sx={{ flexShrink: 0 }}>
                {outcomeLabels[result.outcome]}
              </Typography>
            </ListItem>
          ))}
        </List>
      )}
    </Section>
  )
}

// Named things and how many cards each has, such as the user's decks.
function CountList({
  label,
  items,
  empty,
}: {
  label: string
  items: { id: number; name: string; cardCount: number; detail?: string }[]
  empty: string
}) {
  return items.length === 0 ? (
    <EmptyText>{empty}</EmptyText>
  ) : (
    <List disablePadding dense aria-label={label}>
      {items.map((item) => (
        <ListItem key={item.id} divider disablePadding sx={{ py: 0.5 }}>
          <ListItemText
            primary={item.name}
            secondary={item.detail}
            sx={{ overflowWrap: 'anywhere' }}
          />
          <Typography sx={{ flexShrink: 0, ml: 2 }}>
            {item.cardCount === 1 ? '1 card' : `${item.cardCount} cards`}
          </Typography>
        </ListItem>
      ))}
    </List>
  )
}

function ConnectedApps({ detail }: { detail: AdminUserDetail }) {
  return (
    <Section title="Connected apps">
      {detail.connectedApps.length === 0 ? (
        <EmptyText>No connected apps.</EmptyText>
      ) : (
        <List disablePadding dense aria-label="Connected apps">
          {detail.connectedApps.map((connection) => (
            <ListItem
              key={connection.id}
              divider
              disablePadding
              sx={{ py: 0.5 }}
            >
              <ListItemText
                primary={appName(connection).name}
                secondary={`Connected ${formatDate(connection.createdAt)} · ${
                  connection.lastUsedAt === null
                    ? 'Not used yet'
                    : `Last used ${formatDate(connection.lastUsedAt)}`
                }`}
                sx={{ overflowWrap: 'anywhere' }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Section>
  )
}

function CardsTable({ cards }: { cards: AdminCard[] }) {
  return (
    <ScrollTable label="Cards">
      <TableHead>
        <TableRow>
          <TableCell>Picture</TableCell>
          <TableCell>Spanish</TableCell>
          <TableCell>English</TableCell>
          <TableCell>Tags</TableCell>
          <TableCell>Decks</TableCell>
          <TableCell>Source</TableCell>
          <TableCell>Created</TableCell>
          <TableCell align="right">Score</TableCell>
          <TableCell align="right">Got it</TableCell>
          <TableCell align="right">Close</TableCell>
          <TableCell align="right">Failed</TableCell>
          <TableCell>Last practiced</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {cards.map((card) => {
          const spanish = formatWords(card.spanish)
          return (
            <TableRow key={card.id}>
              <TableCell>
                {card.imageUrl !== null && (
                  <Box
                    component="img"
                    src={card.imageUrl}
                    alt={`Picture for "${spanish}"`}
                    loading="lazy"
                    sx={{
                      display: 'block',
                      width: 40,
                      height: 40,
                      objectFit: 'cover',
                      borderRadius: 1,
                    }}
                  />
                )}
              </TableCell>
              <TableCell lang="es" sx={{ minWidth: 120 }}>
                {spanish}
              </TableCell>
              <TableCell sx={{ minWidth: 120 }}>
                {formatWords(card.english)}
              </TableCell>
              <TableCell>{card.tags.join(', ')}</TableCell>
              <TableCell>{card.decks.join(', ')}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {sourceLabel(card.source)}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {formatDate(card.createdAt)}
              </TableCell>
              <TableCell align="right">{card.score}</TableCell>
              <TableCell align="right">{card.gotIt}</TableCell>
              <TableCell align="right">{card.wasClose}</TableCell>
              <TableCell align="right">{card.failed}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {formatDateTime(card.lastPracticedAt, 'Never')}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </ScrollTable>
  )
}

function Cards({ cards }: { cards: AdminCard[] }) {
  const [search, setSearch] = useState('')
  const matching = cards.filter((card) => matchesCard(card, search))
  return (
    <Section title="Cards">
      {cards.length === 0 ? (
        <EmptyText>No cards.</EmptyText>
      ) : (
        <>
          <TextField
            label="Search"
            type="search"
            size="small"
            fullWidth
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ mb: 2 }}
          />
          {matching.length === 0 ? (
            <EmptyText>No cards match.</EmptyText>
          ) : (
            <CardsTable cards={matching} />
          )}
        </>
      )}
    </Section>
  )
}

// Everything about one user, for an admin: who they are, how they practice, what they've made and connected, and
// each of their cards. It only reads: nothing here changes the user's data.
function AdminUserPage() {
  const id = Number(useParams().id)
  const detail = useLoad(
    (signal): Promise<AdminUserDetail | null> => getAdminUser(id, signal),
    [id],
    {
      operation: 'adminUser',
      fallback: 'Unable to load the user.',
      initial: null,
    },
  )
  const cards = useLoad(
    (signal): Promise<AdminCard[] | null> => listAdminUserCards(id, signal),
    [id],
    {
      operation: 'adminUserCards',
      fallback: "Unable to load the user's cards.",
      initial: null,
    },
  )
  // Both say the same when the user isn't an admin, so it's shown once.
  const errors = [...new Set([detail.error, cards.error])].filter(Boolean)

  if (!detail.loading && !detail.failed && detail.data === null) {
    return <NotFoundPage message="There's no user with this id." />
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Button component={Link} to="/admin">
          All users
        </Button>
      </Box>
      {errors.map((error) => (
        <Alert key={error} severity="error">
          {error}
        </Alert>
      ))}
      {detail.loading ? (
        <Loading />
      ) : (
        detail.data !== null && (
          <>
            <Profile detail={detail.data} />
            <Practice practice={detail.data.practice} />
            <Section title="Cards by source">
              <StatTiles
                stats={Object.entries(detail.data.cardsBySource).map(
                  ([source, count]) => ({
                    label: sourceLabel(source),
                    value: count,
                  }),
                )}
              />
            </Section>
            <Section title="Decks">
              <CountList
                label="Decks"
                empty="No decks."
                items={detail.data.decks.map((deck) => ({
                  ...deck,
                  detail:
                    deck.createdAt === null
                      ? undefined
                      : `Made ${formatDate(deck.createdAt)}`,
                }))}
              />
            </Section>
            <Section title="Tags">
              <CountList
                label="Tags"
                empty="No tags."
                items={detail.data.tags}
              />
            </Section>
            <ConnectedApps detail={detail.data} />
          </>
        )
      )}
      {cards.loading ? (
        <Loading />
      ) : (
        cards.data !== null && <Cards cards={cards.data} />
      )}
    </Stack>
  )
}

export default AdminUserPage
