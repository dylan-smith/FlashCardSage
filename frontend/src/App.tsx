import { useEffect } from 'react'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'
import { Link, Route, Routes, useLocation } from 'react-router'
import logo from './assets/logo.svg'
import { disableGoogleAutoSelect } from './auth/google'
import type { Counts } from './api/counts'
import { sessionSubject, setSession, useSession } from './auth/session'
import SignInPage from './auth/SignInPage'
import { clearCounts, refreshCounts, useCounts } from './hooks/useCounts'
import { loadPreferences, setPreferences } from './hooks/usePreferences'
import DeckPage from './pages/DeckPage'
import DecksPage from './pages/DecksPage'
import FlashCardsPage from './pages/FlashCardsPage'
import ImportCardsPage from './pages/ImportCardsPage'
import PreplyImportPage from './pages/PreplyImportPage'
import NotFoundPage from './pages/NotFoundPage'
import PracticePage from './pages/PracticePage'
import PreferencesPage from './pages/PreferencesPage'
import ScoresPage from './pages/ScoresPage'
import TagsPage from './pages/TagsPage'
import { trackPageView } from './telemetry'

export const tagline = 'Learn a language one card at a time.'

function signOut() {
  disableGoogleAutoSelect()
  setSession(null)
}

type NavItem = { to: string; label: string }

// The parts of Manage cards, each with its own page. A deck's page is part of Decks. A section with a count shows
// how many of its things the user has.
type Section = NavItem & { count?: keyof Counts }

const sections: Section[] = [
  { to: '/', label: 'Cards', count: 'cards' },
  { to: '/decks', label: 'Decks', count: 'decks' },
  { to: '/tags', label: 'Tags', count: 'tags' },
  { to: '/import', label: 'Import cards' },
]

// The app's modes. Manage cards is made up of the sections above.
const modes: (NavItem & { sections?: Section[] })[] = [
  { to: '/', label: 'Manage cards', sections },
  { to: '/practice', label: 'Practice' },
  { to: '/scores', label: 'Scores' },
]

// Whether the path is the item's page or one under it. Every path is under /, so that one only matches itself.
function isAt(pathname: string, { to }: NavItem) {
  return pathname === to || (to !== '/' && pathname.startsWith(`${to}/`))
}

function App() {
  const { pathname } = useLocation()
  const session = useSession()
  // None on a page that doesn't exist.
  const currentMode = modes.find((mode) =>
    (mode.sections ?? [mode]).some((item) => isAt(pathname, item)),
  )

  // One page view for the first load and one for each route change after it, including back and forward.
  useEffect(() => {
    trackPageView()
  }, [pathname])

  // The signed-in user's preferences, forgotten when they sign out, so the next user's are loaded in their place.
  const subject = session === null ? null : sessionSubject(session)
  useEffect(() => {
    if (subject === null) {
      return
    }
    const controller = new AbortController()
    loadPreferences(controller.signal)
    refreshCounts()
    return () => {
      controller.abort()
      setPreferences(null)
      clearCounts()
    }
  }, [subject])
  const counts = useCounts()

  return (
    <Container maxWidth="md" component="main" sx={{ py: 4 }}>
      {session && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 1,
            mb: 1,
          }}
        >
          <Avatar
            src={session.pictureUrl}
            alt=""
            sx={{ width: 28, height: 28, fontSize: 14 }}
          >
            {session.name.charAt(0).toUpperCase()}
          </Avatar>
          <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
            {session.name}
          </Typography>
          <Button
            size="small"
            component={Link}
            to="/preferences"
            aria-current={pathname === '/preferences' ? 'page' : undefined}
            sx={{ flexShrink: 0 }}
          >
            Preferences
          </Button>
          <Button size="small" onClick={signOut} sx={{ flexShrink: 0 }}>
            Sign out
          </Button>
        </Box>
      )}
      <Typography variant="h3" component="h1" gutterBottom>
        <Box
          component={Link}
          to="/"
          sx={{ display: 'block', width: 'fit-content', mx: 'auto' }}
        >
          <Box
            component="img"
            src={logo}
            alt="FlashCardSage"
            sx={{ display: 'block', height: 96, maxWidth: '100%' }}
          />
        </Box>
      </Typography>
      <Typography
        variant="body1"
        color="text.secondary"
        align="center"
        sx={{ mb: 3 }}
      >
        {tagline}
      </Typography>

      {session === null ? (
        <SignInPage />
      ) : (
        <>
          <Box
            component="nav"
            aria-label="Mode"
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 1,
              mb: 3,
            }}
          >
            {modes.map((mode) => {
              const active = mode === currentMode
              return (
                <Button
                  key={mode.to}
                  component={Link}
                  to={mode.to}
                  // A mode with sections is where the user is, and the section's link is the page they're on.
                  aria-current={
                    active ? (mode.sections ? 'true' : 'page') : undefined
                  }
                  variant={active ? 'contained' : 'outlined'}
                >
                  {mode.label}
                </Button>
              )
            })}
          </Box>
          {currentMode?.sections && (
            <Box
              component="nav"
              aria-label={currentMode.label}
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 1,
                mt: -1,
                mb: 3,
              }}
            >
              {currentMode.sections.map((section) => {
                const active = isAt(pathname, section)
                const count =
                  section.count && counts ? counts[section.count] : undefined
                return (
                  <Button
                    key={section.to}
                    component={Link}
                    to={section.to}
                    aria-current={active ? 'page' : undefined}
                    sx={{
                      borderRadius: 0,
                      borderBottom: 2,
                      borderColor: active ? 'primary.main' : 'transparent',
                      fontWeight: active ? 'bold' : undefined,
                    }}
                  >
                    {section.label}
                    {/* The button lays out its content with flex, which drops the space, but it keeps the label
                        and count apart for a screen reader. */}
                    {count !== undefined && ' '}
                    {count !== undefined && (
                      <Box
                        component="span"
                        sx={{
                          ml: 0.75,
                          px: 0.75,
                          minWidth: 20,
                          borderRadius: 10,
                          bgcolor: 'action.selected',
                          color: 'text.secondary',
                          fontSize: 12,
                          lineHeight: '20px',
                        }}
                      >
                        {count}
                      </Box>
                    )}
                  </Button>
                )
              })}
            </Box>
          )}
          <Routes>
            <Route path="/" element={<FlashCardsPage />} />
            <Route path="/decks" element={<DecksPage />} />
            <Route path="/decks/:id" element={<DeckPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/import" element={<ImportCardsPage />} />
            <Route path="/import/preply" element={<PreplyImportPage />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/scores" element={<ScoresPage />} />
            <Route path="/preferences" element={<PreferencesPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </>
      )}
    </Container>
  )
}

export default App
