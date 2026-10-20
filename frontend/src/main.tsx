import { StrictMode } from 'react'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App'
import ErrorBoundary from './components/common/ErrorBoundary'
import { initTelemetry, trackException } from './telemetry'
import { startHandoff } from './wordSources/handoff'
import { theme } from './theme'

initTelemetry()
// Before rendering, since the user may need to sign in before they see the words a bookmarklet sends.
startHandoff()

// The service worker (sw/sw.ts) keeps the app so it opens offline. Only built apps have one: the dev server serves
// the source, which the service worker would keep stale.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      trackException(error, { operation: 'registerServiceWorker' })
    })
  })
}

// Setting these replaces React's default console logging, so keep logging as well as reporting.
function reportRootError(kind: string) {
  return (error: unknown) => {
    console.error(error)
    trackException(error, { kind })
  }
}

createRoot(document.getElementById('root')!, {
  onUncaughtError: reportRootError('uncaught'),
  onCaughtError: reportRootError('caught'),
  onRecoverableError: reportRootError('recoverable'),
}).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
)
