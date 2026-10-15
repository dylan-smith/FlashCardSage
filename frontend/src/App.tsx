import { useEffect } from 'react'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import IconButton from '@mui/material/IconButton'
import SvgIcon from '@mui/material/SvgIcon'
import Tooltip from '@mui/material/Tooltip'
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
import NotFoundPage from './pages/NotFoundPage'
import PracticePage from './pages/PracticePage'
import PreferencesPage from './pages/PreferencesPage'
import ScoresPage from './pages/ScoresPage'
import TagsPage from './pages/TagsPage'
import { trackPageView } from './telemetry'
import { Toaster } from './Toaster'

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
          <Tooltip title="Preferences">
            <IconButton
              size="small"
              component={Link}
              to="/preferences"
              aria-label="Preferences"
              aria-current={pathname === '/preferences' ? 'page' : undefined}
              color={pathname === '/preferences' ? 'primary' : 'default'}
              sx={{ flexShrink: 0 }}
            >
              <SvgIcon fontSize="small">
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
              </SvgIcon>
            </IconButton>
          </Tooltip>
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
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/scores" element={<ScoresPage />} />
            <Route path="/preferences" element={<PreferencesPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </>
      )}
      <Toaster />
    </Container>
  )
}

export default App
