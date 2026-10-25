import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import type { Preferences } from '../api/preferences'
import { useChangePreference, usePreferences } from '../hooks/usePreferences'
import { Loading } from '../components/common/Loading'
import { Section } from '../components/common/Section'
import { ConnectedApps } from '../components/preferences/ConnectedApps'

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
  {
    key: 'showGettingStarted',
    label: 'Show the getting started guide',
    description:
      'Show the guide at the top of the Cards page that walks you through adding cards, practicing them and seeing your scores. Hide guide there turns this off.',
  },
]

// The user's preferences, each saved as soon as it's changed, and the apps they've connected.
function PreferencesPage() {
  const preferences = usePreferences()
  const [errorMessage, setErrorMessage] = useState('')
  // The switches stay enabled while a save is on its way, so the one the user changed keeps focus.
  const changePreference = useChangePreference(setErrorMessage)

  function change(key: keyof Preferences, value: boolean) {
    setErrorMessage('')
    changePreference(key, value)
  }

  return (
    <Stack spacing={2}>
      <Section title="Preferences">
        {errorMessage && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorMessage}
          </Alert>
        )}
        {preferences === null ? (
          <Loading />
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
      </Section>
      <Section title="Connected apps">
        <ConnectedApps />
      </Section>
    </Stack>
  )
}

export default PreferencesPage
