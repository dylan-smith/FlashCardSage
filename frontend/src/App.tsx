import { useEffect } from 'react'
import Container from '@mui/material/Container'
import { Route, Routes, useLocation } from 'react-router'
import { useSession } from './auth/session'
import LandingPage from './pages/LandingPage'
import { useSignedInUserData } from './hooks/useSignedInUserData'
import AdminPage from './pages/admin/AdminPage'
import AdminUserPage from './pages/admin/AdminUserPage'
import AuthorizePage from './pages/AuthorizePage'
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
import { Toaster } from './components/common/Toaster'
import { Brand } from './components/layout/Brand'
import { ModeNav } from './components/layout/ModeNav'
import { SectionNav } from './components/layout/SectionNav'
import { UserBar } from './components/layout/UserBar'
import { isAt, modeAt } from './components/layout/nav'

function App() {
  const { pathname } = useLocation()
  const session = useSession()
  const currentMode = modeAt(pathname)
  // The consent page an app's sign-in comes to stands alone, with nothing to lead the user off to another page.
  const consenting = pathname === '/authorize'
  // The admin pages' tables have a lot of columns, so they get more room.
  const wide = isAt(pathname, { to: '/admin', label: 'Admin' })

  // One page view for the first load and one for each route change after it, including back and forward.
  useEffect(() => {
    trackPageView()
  }, [pathname])

  useSignedInUserData(session)

  return (
    <Container maxWidth={wide ? 'lg' : 'md'} component="main" sx={{ py: 4 }}>
      {session && !consenting && (
        <UserBar session={session} pathname={pathname} />
      )}
      <Brand />

      {session === null ? (
        <LandingPage />
      ) : (
        <>
          {!consenting && <ModeNav current={currentMode} />}
          {currentMode?.sections && (
            <SectionNav
              label={currentMode.label}
              sections={currentMode.sections}
              pathname={pathname}
            />
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
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/users/:id" element={<AdminUserPage />} />
            <Route path="/authorize" element={<AuthorizePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </>
      )}
      <Toaster />
    </Container>
  )
}

export default App
