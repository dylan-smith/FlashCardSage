import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import SignInPage from '../auth/SignInPage'
import {
  features,
  headline,
  highlights,
  subhead,
  type Feature,
} from './landingCopy'

// A feature's clip: a few seconds of the part of the app that does it, silent, playing on a loop. The
// clips are in public/demos/ under versioned names, so they're served with a long cache lifetime and never
// precached by the service worker (see vite.config.ts). Someone who asks for less motion gets the poster and a
// play button instead of a loop.
function FeatureDemo({ feature }: { feature: Feature }) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  return (
    <Box
      sx={{
        gridArea: 'demo',
        justifySelf: 'center',
        width: { xs: '100%', sm: 320 },
        maxWidth: 320,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'background.default',
        boxShadow: 4,
      }}
    >
      <video
        muted
        loop
        playsInline
        autoPlay={!reduceMotion}
        controls={reduceMotion}
        preload={reduceMotion ? 'none' : 'auto'}
        poster={`${feature.demo}.jpg`}
        aria-label={`Demo: ${feature.title}`}
        style={{ display: 'block', width: '100%', aspectRatio: '640 / 592' }}
      >
        <source src={`${feature.demo}.mp4`} type="video/mp4" />
      </video>
    </Box>
  )
}

// What signed-out visitors see, at every address: what the app does, a clip of each feature, and the sign-in.
// Sign-in stays on the page the visitor came to, so a bookmarklet's handoff and an app's consent page carry on
// once they're in.
function LandingPage() {
  return (
    <Stack spacing={6}>
      <Box
        sx={{
          display: 'grid',
          gap: 4,
          gridTemplateColumns: { xs: '1fr', md: '1fr minmax(0, 480px)' },
          gridTemplateAreas: {
            xs: '"text" "signin"',
            md: '"text signin"',
          },
          alignItems: 'center',
        }}
      >
        <Box sx={{ gridArea: 'text', minWidth: 0 }}>
          <Typography variant="h4" component="h2" gutterBottom>
            {headline}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 1 }}>
            {subhead}
          </Typography>
          <List dense disablePadding>
            {highlights.map((highlight) => (
              <ListItem key={highlight} disableGutters>
                <ListItemIcon
                  aria-hidden
                  sx={{
                    minWidth: 28,
                    color: 'secondary.main',
                    fontWeight: 700,
                  }}
                >
                  ✓
                </ListItemIcon>
                <ListItemText primary={highlight} />
              </ListItem>
            ))}
          </List>
        </Box>
        <Box id="sign-in" sx={{ gridArea: 'signin', scrollMarginTop: 16 }}>
          <SignInPage />
        </Box>
      </Box>

      <Box component="section" aria-labelledby="landing-features">
        <Typography
          id="landing-features"
          variant="h5"
          component="h2"
          align="center"
          sx={{ mb: 4 }}
        >
          What it does
        </Typography>
        <Stack spacing={6}>
          {features.map((feature, index) => (
            <Box
              key={feature.demo}
              component="article"
              sx={{
                display: 'grid',
                gap: { xs: 2, md: 4 },
                alignItems: 'center',
                gridTemplateColumns: {
                  xs: '1fr',
                  // The clip swaps sides from one feature to the next.
                  md: index % 2 === 0 ? 'auto 1fr' : '1fr auto',
                },
                gridTemplateAreas: {
                  xs: '"demo" "text"',
                  md: index % 2 === 0 ? '"demo text"' : '"text demo"',
                },
              }}
            >
              <FeatureDemo feature={feature} />
              <Box sx={{ gridArea: 'text', minWidth: 0 }}>
                <Typography variant="h5" component="h3" sx={{ mb: 1 }}>
                  {feature.title}
                </Typography>
                <Typography color="text.secondary">
                  {feature.description}
                </Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      </Box>

      <Stack spacing={2} sx={{ alignItems: 'center' }}>
        <Button href="#sign-in" variant="contained" size="large">
          Get started, it&apos;s free
        </Button>
        <Typography color="text.secondary" align="center">
          Only you can see your cards.
        </Typography>
      </Stack>
    </Stack>
  )
}

export default LandingPage
