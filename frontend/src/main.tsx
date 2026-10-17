import { StrictMode } from 'react'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App'
import ErrorBoundary from './components/common/ErrorBoundary'
import { initTelemetry, trackException } from './telemetry'
import { startPreplyHandoff } from './preply/preplyHandoff'
import { theme } from './theme'

initTelemetry()
// Before rendering, since the user may need to sign in before they see the words the bookmarklet sends.
startPreplyHandoff()

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
