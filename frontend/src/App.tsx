import { useEffect } from 'react'
import Container from '@mui/material/Container'
import { Route, Routes, useLocation } from 'react-router'
import { useSession } from './auth/session'
import SignInPage from './auth/SignInPage'
import { useSignedInUserData } from './hooks/useSignedInUserData'
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
import { modeAt } from './components/layout/nav'

function App() {
  const { pathname } = useLocation()
  const session = useSession()
  const currentMode = modeAt(pathname)
  // The consent page an app's sign-in comes to stands alone, with nothing to lead the user off to another page.
  const consenting = pathname === '/authorize'

  // One page view for the first load and one for each route change after it, including back and forward.
  useEffect(() => {
    trackPageView()
  }, [pathname])

  useSignedInUserData(session)

  return (
    <Container maxWidth="md" component="main" sx={{ py: 4 }}>
      {session && !consenting && (
        <UserBar session={session} pathname={pathname} />
      )}
      <Brand />

      {session === null ? (
        <SignInPage />
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
