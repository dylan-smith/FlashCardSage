import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0e2841',
    },
    secondary: {
      main: '#1b9a57',
    },
    background: {
      default: '#f3f4f6',
    },
    text: {
      primary: '#111827',
    },
  },
  typography: {
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  },
  // Lists and dialogs animate, except for a user whose system asks for less motion.
  motion: { reducedMotion: 'system' },
})
