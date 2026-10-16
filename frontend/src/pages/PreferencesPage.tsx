import { useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { describeFetchError } from '../api/client'
import { savePreferences } from '../api/preferences'
import type { Preferences } from '../api/preferences'
import {
  currentPreferences,
  setPreferences,
  usePreferences,
} from '../hooks/usePreferences'
import { trackEvent, trackException } from '../telemetry'

const options: {
  key: keyof Preferences
  label: string
  description: string
}[] = [
  {
    key: 'showPictures',
    label: 'Show pictures',
    description:
      "Show cards' pictures in practice and where you manage your cards, and offer to make one for a card.",
  },
  {
    key: 'showSuggestions',
    label: 'Suggest cards',
    description:
      'Suggest new cards that go with yours on the Cards page, tags for a card you add or edit, and new tags on the Tags page.',
  },
  {
    key: 'autoTranslate',
    label: 'Translate automatically',
    description:
      "Fill in the other side of a card with a translation of the side you type. When it's off, you type both sides.",
  },
]

// The user's preferences, each saved as soon as it's changed.
function PreferencesPage() {
  const preferences = usePreferences()
  const [errorMessage, setErrorMessage] = useState('')
  // The saves, one after another, so the last change is the one the API keeps. The switches stay enabled while one
  // is on its way, so the one the user changed keeps focus.
  const saves = useRef(Promise.resolve())

  // Shows the change right away, and turns it back if it isn't saved.
  function change(key: keyof Preferences, value: boolean) {
    if (preferences === null) {
      return
    }
    const changed = { ...preferences, [key]: value }
    setErrorMessage('')
    setPreferences(changed)
    saves.current = saves.current.then(async () => {
      try {
        await savePreferences(changed)
        trackEvent('PreferencesUpdated')
      } catch (error) {
        trackException(error, { operation: 'savePreferences' })
        const latest = currentPreferences()
        if (latest !== null) {
          setPreferences({ ...latest, [key]: !value })
        }
        setErrorMessage(
          describeFetchError(error, 'Unable to save preferences.'),
        )
      }
    })
  }

  return (
    <Paper component="section" elevation={2} sx={{ p: 3 }}>
      <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
        Preferences
      </Typography>
      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
      )}
      {preferences === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress aria-label="Loading" />
        </Box>
      ) : (
        <FormGroup sx={{ gap: 2 }}>
          {options.map(({ key, label, description }) => (
            <Box key={key}>
              <FormControlLabel
                label={label}
                control={
                  <Switch
                    checked={preferences[key]}
                    onChange={(event) => change(key, event.target.checked)}
                    slotProps={{
                      input: { 'aria-describedby': `${key}-description` },
                    }}
                  />
                }
              />
              <Typography
                id={`${key}-description`}
                variant="body2"
                color="text.secondary"
                sx={{ ml: 6 }}
              >
                {description}
              </Typography>
            </Box>
          ))}
        </FormGroup>
      )}
    </Paper>
  )
}

export default PreferencesPage
