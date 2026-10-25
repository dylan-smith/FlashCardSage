import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type {
  AdminCard,
  AdminOverview,
  AdminUserDetail,
  AdminUserSummary,
} from '../../api/admin'
import { formatDate, formatDateTime } from '../../lib/adminFormat'
import { trackException } from '../../telemetry'
import { emptyResponse, mockApi } from '../support/mockApi'
import type { Routes } from '../support/mockApi'
import { renderAt, renderLoaded, signInForEachTest } from '../support/render'

signInForEachTest()

const admin = { displayName: 'Tester', email: null, isAdmin: true }

const bySource = {
  Manual: 3,
  Suggested: 1,
  Document: 0,
  Preply: 0,
  Duolingo: 0,
  SystemDeck: 2,
  Mcp: 0,
  Unknown: 1,
}

const overview: AdminOverview = {
  users: 2,
  activeUsersLast7Days: 1,
  activeUsersLast30Days: 2,
  newUsersLast30Days: 1,
  cards: 7,
  decks: 2,
  tags: 3,
  practiceResults: 12,
  practiceResultsLast7Days: 5,
  practiceResultsLast30Days: 9,
  listeningPracticeResultsLast30Days: 4,
  listeningUsersLast30Days: 1,
  cardsBySource: bySource,
  cachedTranslations: 40,
  generatedImages: 6,
  generatedAudio: 9,
  oAuthClients: 1,
  connectedApps: 1,
}

function user(
  id: number,
  fields: Partial<AdminUserSummary> = {},
): AdminUserSummary {
  return {
    id,
    subject: `google:${id}`,
    provider: 'google',
    displayName: `User ${id}`,
    email: `user${id}@example.com`,
    createdAt: '2026-10-01T09:00:00Z',
    lastSeenAt: null,
    cards: 0,
    decks: 0,
    tags: 0,
    practiceResults: 0,
    lastPracticedAt: null,
    connectedApps: 0,
    score: 0,
    maximumScore: 0,
    ...fields,
  }
}

const maria = user(2, {
  displayName: 'María López',
  email: 'maria@example.com',
  lastSeenAt: '2026-10-20T10:30:00Z',
  cards: 7,
  decks: 2,
  tags: 3,
  practiceResults: 12,
  lastPracticedAt: '2026-10-19T08:00:00Z',
  connectedApps: 1,
  score: 455,
  maximumScore: 700,
})
const tom = user(3, {
  displayName: null,
  subject: 'test:Tom',
  provider: 'test',
  email: null,
  lastSeenAt: '2026-10-21T10:30:00Z',
  cards: 1,
  maximumScore: 100,
})
const never = user(4, { displayName: 'Never Seen' })

function adminRoutes(routes: Routes = {}): Routes {
  return {
    'GET /me': admin,
    'GET /admin/overview': overview,
    // Out of order, to check the page puts the one seen most recently first.
    'GET /admin/users': [maria, never, tom],
    ...routes,
  }
}

// The users table's rows, each as its cells' text.
function userRows() {
  const rows = within(
    screen.getByRole('table', { name: 'Users' }),
  ).getAllByRole('row')
  return rows.slice(1).map((row) =>
    within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  )
}

// Each term on the page with what it is, such as a total with its number, in order.
function terms() {
  const definitions = screen.getAllByRole('definition')
  return screen
    .getAllByRole('term')
    .map((term, index) => [term.textContent, definitions[index].textContent])
}

describe('admin link', () => {
  it("isn't shown to a user who isn't an admin", async () => {
    const { background } = await renderLoaded('/')

    await waitFor(() => {
      expect(background.some('GET', '/me')).toBe(true)
    })
    expect(
      screen.getByRole('link', { name: 'Preferences' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Admin' }),
    ).not.toBeInTheDocument()
  })

  it("isn't shown when the API can't say whether the user is an admin", async () => {
    await renderLoaded('/', { 'GET /me': emptyResponse(500) })

    await waitFor(() => {
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'loadAdminStatus',
      })
    })
    expect(
      screen.queryByRole('link', { name: 'Admin' }),
    ).not.toBeInTheDocument()
  })

  it('is shown to an admin, and opens the admin page', async () => {
    const user = userEvent.setup()
    mockApi(adminRoutes())
    renderAt('/')

    const link = await screen.findByRole('link', { name: 'Admin' })
    expect(link).toHaveAttribute('href', '/admin')
    expect(link).not.toHaveAttribute('aria-current')

    await user.click(link)

    expect(
      await screen.findByRole('heading', { level: 2, name: 'All users' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // The admin pages aren't one of the modes.
    expect(
      within(screen.getByRole('navigation', { name: 'Mode' }))
        .getAllByRole('link')
        .map((item) => item.getAttribute('aria-current')),
    ).toEqual([null, null, null])
  })
})

describe('admin page', () => {
  it('shows the totals and every user, the one seen most recently first', async () => {
    await renderLoaded('/admin', adminRoutes())

    expect(terms()).toEqual(
      expect.arrayContaining([
        ['Users', '2'],
        ['Active in the last 7 days', '1'],
        ['Practice results in the last 30 days', '9'],
        ['Listening-mode results in the last 30 days', '4'],
        ['Listening-mode users in the last 30 days', '1'],
        ['Added by hand', '3'],
        ['Built-in deck', '2'],
        ['Unknown', '1'],
        ['Cached translations', '40'],
        ['Cached audio', '9'],
        ['Registered apps', '1'],
      ]),
    )

    expect(userRows()).toEqual([
      [
        'test:Tom',
        '',
        'test',
        formatDate(tom.createdAt),
        formatDateTime(tom.lastSeenAt),
        '1',
        '0 / 100 (0%)',
        '0',
        '0',
        '0',
        'Never',
        '0',
      ],
      [
        'María López',
        'maria@example.com',
        'google',
        formatDate(maria.createdAt),
        formatDateTime(maria.lastSeenAt),
        '7',
        '455 / 700 (65%)',
        '2',
        '3',
        '12',
        formatDateTime(maria.lastPracticedAt),
        '1',
      ],
      [
        'Never Seen',
        'user4@example.com',
        'google',
        formatDate(never.createdAt),
        'Unknown',
        '0',
        'No cards',
        '0',
        '0',
        '0',
        'Never',
        '0',
      ],
    ])
    expect(screen.getByRole('link', { name: 'María López' })).toHaveAttribute(
      'href',
      '/admin/users/2',
    )
  })

  it('finds users by name, email or sign-in, whatever their accents and case', async () => {
    const user = userEvent.setup()
    await renderLoaded('/admin', adminRoutes())
    const search = screen.getByRole('searchbox', { name: 'Search' })

    await user.type(search, 'MARIA')
    expect(userRows().map((row) => row[0])).toEqual(['María López'])

    await user.clear(search)
    await user.type(search, 'user4@')
    expect(userRows().map((row) => row[0])).toEqual(['Never Seen'])

    await user.clear(search)
    await user.type(search, 'test:tom')
    expect(userRows().map((row) => row[0])).toEqual(['test:Tom'])

    await user.type(search, 'x')
    expect(screen.getByText('No users match.')).toBeInTheDocument()
    expect(
      screen.queryByRole('table', { name: 'Users' }),
    ).not.toBeInTheDocument()
  })

  it("says so to a user who isn't an admin", async () => {
    await renderLoaded('/admin', {
      'GET /admin/overview': emptyResponse(403),
      'GET /admin/users': emptyResponse(403),
    })

    // Once, though both requests were turned away.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only admins can see this page.',
    )
    expect(
      screen.queryByRole('table', { name: 'Users' }),
    ).not.toBeInTheDocument()
  })

  it('shows an error when the users fail to load', async () => {
    await renderLoaded(
      '/admin',
      adminRoutes({ 'GET /admin/users': emptyResponse(500) }),
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to load the users.',
    )
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'adminUsers',
    })
    // The totals still show.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Cards by source' }),
    ).toBeInTheDocument()
  })
})

describe('admin user page', () => {
  const detail: AdminUserDetail = {
    user: maria,
    preferences: {
      showPictures: true,
      showSuggestions: false,
      autoTranslate: true,
    },
    decks: [
      {
        id: 5,
        name: 'Animals',
        createdAt: '2026-10-02T09:00:00Z',
        cardCount: 2,
      },
      { id: 6, name: 'Old deck', createdAt: null, cardCount: 1 },
    ],
    tags: [{ id: 8, name: 'Pets', cardCount: 1 }],
    practice: {
      gotIt: 7,
      wasClose: 3,
      failed: 2,
      listening: 5,
      firstPracticedAt: '2026-10-05T08:00:00Z',
      lastPracticedAt: '2026-10-19T08:00:00Z',
      byDay: Array.from({ length: 30 }, (_, index) => ({
        date: `2026-09-${String(index + 1).padStart(2, '0')}`,
        results: index === 29 ? 4 : 0,
      })),
      recent: [
        {
          flashCardId: 1,
          spanish: ['el gato'],
          outcome: 'WasClose',
          practicedAt: '2026-10-19T08:00:00Z',
          listening: true,
        },
      ],
    },
    connectedApps: [
      {
        id: 3,
        clientName: 'Claude',
        clientHost: 'claude.ai',
        clientNameIsSelfAsserted: false,
        scopes: ['flashcards'],
        createdAt: '2026-10-18T09:00:00Z',
        lastUsedAt: null,
      },
    ],
    cardsBySource: bySource,
  }

  function adminCard(id: number, fields: Partial<AdminCard>): AdminCard {
    return {
      id,
      spanish: [],
      english: [],
      tags: [],
      decks: [],
      imageUrl: null,
      createdAt: null,
      source: 'Unknown',
      score: 0,
      gotIt: 0,
      wasClose: 0,
      failed: 0,
      lastPracticedAt: null,
      ...fields,
    }
  }

  const cards: AdminCard[] = [
    adminCard(1, {
      spanish: ['el gato'],
      english: ['the cat'],
      tags: ['Pets'],
      decks: ['Animals'],
      imageUrl: 'https://pictures.example.com/cat.png',
      createdAt: '2026-10-03T09:00:00Z',
      source: 'Duolingo',
      score: 60,
      gotIt: 2,
      wasClose: 1,
      lastPracticedAt: '2026-10-19T08:00:00Z',
    }),
    adminCard(2, { spanish: ['la casa'], english: ['the house'] }),
  ]

  function userRoutes(routes: Routes = {}) {
    return adminRoutes({
      'GET /admin/users/2': detail,
      'GET /admin/users/2/cards': cards,
      ...routes,
    })
  }

  function cardRows() {
    return within(screen.getByRole('table', { name: 'Cards' }))
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      )
  }

  it('shows who the user is, how they practice, and their decks, tags, apps and cards', async () => {
    await renderLoaded('/admin/users/2', userRoutes())

    expect(
      screen.getByRole('heading', { level: 2, name: 'María López' }),
    ).toBeInTheDocument()
    expect(terms()).toEqual(
      expect.arrayContaining([
        ['Email', 'maria@example.com'],
        ['Sign-in', 'google:2'],
        ['Last seen', formatDateTime(maria.lastSeenAt)],
        ['Score', '455 / 700 (65%)'],
        ['Show pictures', 'On'],
        ['Suggest cards', 'Off'],
        ['Got it', '7'],
        ['Close', '3'],
        ['Failed', '2'],
        ['Listening mode', '5'],
        ['Added by hand', '3'],
      ]),
    )

    const days = within(
      screen.getByRole('list', { name: 'Practice results by day' }),
    ).getAllByRole('listitem')
    expect(days).toHaveLength(30)
    expect(days[29]).toHaveTextContent(/4$/)
    expect(
      within(screen.getByRole('list', { name: 'Recent results' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      `el gato${formatDateTime('2026-10-19T08:00:00Z')}, listening modeClose`,
    ])

    expect(
      within(screen.getByRole('list', { name: 'Decks' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      `AnimalsMade ${formatDate('2026-10-02T09:00:00Z')}2 cards`,
      'Old deck1 card',
    ])
    expect(
      within(screen.getByRole('list', { name: 'Tags' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Pets1 card'])
    expect(
      within(screen.getByRole('list', { name: 'Connected apps' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      `claude.aiConnected ${formatDate('2026-10-18T09:00:00Z')} · Not used yet`,
    ])

    expect(cardRows()).toEqual([
      [
        '',
        'el gato',
        'the cat',
        'Pets',
        'Animals',
        'Duolingo',
        formatDate('2026-10-03T09:00:00Z'),
        '60',
        '2',
        '1',
        '0',
        formatDateTime('2026-10-19T08:00:00Z'),
      ],
      [
        '',
        'la casa',
        'the house',
        '',
        '',
        'Unknown',
        'Unknown',
        '0',
        '0',
        '0',
        '0',
        'Never',
      ],
    ])
    expect(
      screen.getByRole('img', { name: 'Picture for "el gato"' }),
    ).toHaveAttribute('src', 'https://pictures.example.com/cat.png')
    expect(screen.getByRole('link', { name: 'All users' })).toHaveAttribute(
      'href',
      '/admin',
    )
  })

  it("finds the user's cards by their words, tags, decks or source", async () => {
    const user = userEvent.setup()
    await renderLoaded('/admin/users/2', userRoutes())
    const search = screen.getByRole('searchbox', { name: 'Search' })

    for (const query of ['GATO', 'pets', 'animals', 'duolingo']) {
      await user.clear(search)
      await user.type(search, query)
      expect(cardRows().map((row) => row[1])).toEqual(['el gato'])
    }

    await user.clear(search)
    await user.type(search, 'house')
    expect(cardRows().map((row) => row[1])).toEqual(['la casa'])

    await user.type(search, 'x')
    expect(screen.getByText('No cards match.')).toBeInTheDocument()
  })

  it("says there's no such user", async () => {
    await renderLoaded(
      '/admin/users/9',
      adminRoutes({
        'GET /admin/users/9': emptyResponse(404),
        'GET /admin/users/9/cards': emptyResponse(404),
      }),
    )

    expect(
      screen.getByRole('heading', { level: 2, name: 'Page not found' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText("There's no user with this id."),
    ).toBeInTheDocument()
  })

  it("says so to a user who isn't an admin", async () => {
    await renderLoaded('/admin/users/2', {
      'GET /admin/users/2': emptyResponse(403),
      'GET /admin/users/2/cards': emptyResponse(403),
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only admins can see this page.',
    )
    expect(
      screen.queryByRole('table', { name: 'Cards' }),
    ).not.toBeInTheDocument()
  })
})
