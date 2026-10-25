import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import { Link as RouterLink } from 'react-router'
import { getAdminOverview, listAdminUsers } from '../../api/admin'
import type { AdminOverview, AdminUserSummary } from '../../api/admin'
import { useLoad } from '../../hooks/useLoad'
import { matchesSearch } from '../../lib/cardSearch'
import {
  formatDate,
  formatDateTime,
  formatScore,
  sourceLabel,
  userName,
} from '../../lib/adminFormat'
import { EmptyText } from '../../components/common/EmptyText'
import { Loading } from '../../components/common/Loading'
import { Section } from '../../components/common/Section'
import { ScrollTable } from '../../components/admin/ScrollTable'
import { StatTiles } from '../../components/admin/StatTiles'

// Whether the user has the search in their name, email or sign-in, whatever its accents and case. It's searched the
// way a card's words are.
function matchesUser(user: AdminUserSummary, search: string) {
  return matchesSearch(
    {
      spanish: [userName(user), user.subject],
      english: user.email === null ? [] : [user.email],
    },
    search,
  )
}

// The one seen most recently first, and those never seen last.
function byLastSeen(a: AdminUserSummary, b: AdminUserSummary) {
  const seen = (user: AdminUserSummary) =>
    user.lastSeenAt === null ? -Infinity : Date.parse(user.lastSeenAt)
  return seen(b) - seen(a)
}

function OverviewSections({ overview }: { overview: AdminOverview }) {
  return (
    <>
      <Section title="Users">
        <StatTiles
          stats={[
            { label: 'Users', value: overview.users },
            {
              label: 'Active in the last 7 days',
              value: overview.activeUsersLast7Days,
            },
            {
              label: 'Active in the last 30 days',
              value: overview.activeUsersLast30Days,
            },
            {
              label: 'New in the last 30 days',
              value: overview.newUsersLast30Days,
            },
          ]}
        />
      </Section>
      <Section title="Cards and practice">
        <StatTiles
          stats={[
            { label: 'Cards', value: overview.cards },
            { label: 'Decks', value: overview.decks },
            { label: 'Tags', value: overview.tags },
            { label: 'Practice results', value: overview.practiceResults },
            {
              label: 'Practice results in the last 7 days',
              value: overview.practiceResultsLast7Days,
            },
            {
              label: 'Practice results in the last 30 days',
              value: overview.practiceResultsLast30Days,
            },
            {
              label: 'Listening-mode results in the last 30 days',
              value: overview.listeningPracticeResultsLast30Days,
            },
            {
              label: 'Listening-mode users in the last 30 days',
              value: overview.listeningUsersLast30Days,
            },
          ]}
        />
      </Section>
      <Section title="Cards by source">
        <StatTiles
          stats={Object.entries(overview.cardsBySource).map(
            ([source, count]) => ({ label: sourceLabel(source), value: count }),
          )}
        />
      </Section>
      <Section title="Shared">
        <StatTiles
          stats={[
            {
              label: 'Cached translations',
              value: overview.cachedTranslations,
            },
            { label: 'Generated pictures', value: overview.generatedImages },
            { label: 'Cached audio', value: overview.generatedAudio },
            { label: 'Registered apps', value: overview.oAuthClients },
            { label: 'Connected apps', value: overview.connectedApps },
          ]}
        />
      </Section>
    </>
  )
}

function UsersTable({ users }: { users: AdminUserSummary[] }) {
  return (
    <ScrollTable label="Users">
      <TableHead>
        <TableRow>
          <TableCell>Name</TableCell>
          <TableCell>Email</TableCell>
          <TableCell>Provider</TableCell>
          <TableCell>Signed up</TableCell>
          <TableCell>Last seen</TableCell>
          <TableCell align="right">Cards</TableCell>
          <TableCell align="right">Score</TableCell>
          <TableCell align="right">Decks</TableCell>
          <TableCell align="right">Tags</TableCell>
          <TableCell align="right">Practice results</TableCell>
          <TableCell>Last practiced</TableCell>
          <TableCell align="right">Apps</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id} hover>
            <TableCell sx={{ overflowWrap: 'anywhere', minWidth: 120 }}>
              <Link component={RouterLink} to={`/admin/users/${user.id}`}>
                {userName(user)}
              </Link>
            </TableCell>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>
              {user.email ?? ''}
            </TableCell>
            <TableCell>{user.provider}</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>
              {formatDate(user.createdAt)}
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>
              {formatDateTime(user.lastSeenAt)}
            </TableCell>
            <TableCell align="right">{user.cards}</TableCell>
            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
              {formatScore(user)}
            </TableCell>
            <TableCell align="right">{user.decks}</TableCell>
            <TableCell align="right">{user.tags}</TableCell>
            <TableCell align="right">{user.practiceResults}</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>
              {formatDateTime(user.lastPracticedAt, 'Never')}
            </TableCell>
            <TableCell align="right">{user.connectedApps}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </ScrollTable>
  )
}

// Everyone's totals and every user, for an admin to see how the site is used. It only reads: nothing here changes a
// user's data.
function AdminPage() {
  const [search, setSearch] = useState('')
  const overview = useLoad(
    (signal): Promise<AdminOverview | null> => getAdminOverview(signal),
    [],
    {
      operation: 'adminOverview',
      fallback: 'Unable to load the overview.',
      initial: null,
    },
  )
  const users = useLoad(
    (signal): Promise<AdminUserSummary[] | null> => listAdminUsers(signal),
    [],
    {
      operation: 'adminUsers',
      fallback: 'Unable to load the users.',
      initial: null,
    },
  )
  // Both say the same when the user isn't an admin, so it's shown once.
  const errors = [...new Set([overview.error, users.error])].filter(Boolean)
  const matching =
    users.data?.filter((user) => matchesUser(user, search)).sort(byLastSeen) ??
    []

  return (
    <Stack spacing={2}>
      {errors.map((error) => (
        <Alert key={error} severity="error">
          {error}
        </Alert>
      ))}
      {overview.loading ? (
        <Loading />
      ) : (
        overview.data !== null && <OverviewSections overview={overview.data} />
      )}
      {users.loading ? (
        <Loading />
      ) : (
        users.data !== null && (
          <Section title="All users">
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
              <EmptyText>
                {users.data.length === 0 ? 'No users yet.' : 'No users match.'}
              </EmptyText>
            ) : (
              <UsersTable users={matching} />
            )}
          </Section>
        )
      )}
    </Stack>
  )
}

export default AdminPage
