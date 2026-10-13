import { useEffect } from 'react'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router'
import logo from './assets/logo.svg'
import { disableGoogleAutoSelect } from './auth/google'
import { setSession, useSession } from './auth/session'
import SignInPage from './auth/SignInPage'
import DeckPage from './pages/DeckPage'
import DecksPage from './pages/DecksPage'
import FlashCardsPage from './pages/FlashCardsPage'
import NotFoundPage from './pages/NotFoundPage'
import PracticePage from './pages/PracticePage'
import ScoresPage from './pages/ScoresPage'
import { trackPageView } from './telemetry'

export const tagline = 'Learn a language one card at a time.'

function signOut() {
  disableGoogleAutoSelect()
  setSession(null)
}

// The app's modes. NavLink marks the current one with aria-current.
const modes = [
  { to: '/', label: 'Manage cards' },
  { to: '/decks', label: 'Decks' },
  { to: '/practice', label: 'Practice' },
  { to: '/scores', label: 'Scores' },
]

function App() {
  const { pathname } = useLocation()
  const session = useSession()

  // One page view for the first load and one for each route change after it, including back and forward.
  useEffect(() => {
    trackPageView()
  }, [pathname])

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
            {modes.map(({ to, label }) => (
              <Button
                key={to}
                component={NavLink}
                to={to}
                // A deck's own page is part of the Decks mode, but every page is under /.
                end={to === '/'}
                variant={
                  pathname === to ||
                  (to !== '/' && pathname.startsWith(`${to}/`))
                    ? 'contained'
                    : 'outlined'
                }
              >
                {label}
              </Button>
            ))}
          </Box>
          <Routes>
            <Route path="/" element={<FlashCardsPage />} />
            <Route path="/decks" element={<DecksPage />} />
            <Route path="/decks/:id" element={<DeckPage />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/scores" element={<ScoresPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </>
      )}
    </Container>
  )
}

export default App
