import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { Link } from 'react-router'
import logo from '../../assets/logo.svg'

export const tagline = 'Learn a language one card at a time.'

// The app's logo, as its heading and a link to the cards page, and its tagline.
export function Brand() {
  return (
    <>
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
    </>
  )
}
