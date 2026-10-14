import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { bookmarkletHref } from '../preply/sendToFlashCardSage'

export const preplyVocabularyUrl =
  'https://preply.com/en/practice/vocab-bank?subject=spanish'

// How to bring in the user's Preply vocabulary: a bookmarklet they drag to their bookmarks bar and click on Preply.
export function PreplyBookmarklet() {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const [clicked, setClicked] = useState(false)

  // React won't render a javascript: address, so it's set on the link itself.
  useEffect(() => {
    linkRef.current?.setAttribute(
      'href',
      bookmarkletHref(window.location.origin),
    )
  }, [])

  return (
    <Paper component="section" elevation={2} sx={{ p: 3 }}>
      <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
        From Preply
      </Typography>
      <Typography color="text.secondary" component="div" sx={{ mb: 2 }}>
        Bring in the words in your Preply vocabulary as a new deck:
        <Box component="ol" sx={{ my: 1, pl: 3 }}>
          <li>Drag the button below to your bookmarks bar.</li>
          <li>
            Open your{' '}
            <a href={preplyVocabularyUrl} target="_blank" rel="noreferrer">
              Preply vocabulary
            </a>
            , signed in to Preply.
          </li>
          <li>
            Click the bookmark. FlashCardSage opens with your words to pick
            from.
          </li>
        </Box>
      </Typography>
      <Button
        component="a"
        ref={linkRef}
        // Replaced with the bookmarklet once rendered. Without an address, it isn't a link.
        href="#send-to-flashcardsage"
        variant="outlined"
        onClick={(event: React.MouseEvent) => {
          // It only works as a bookmark on Preply.
          event.preventDefault()
          setClicked(true)
        }}
      >
        Send to FlashCardSage
      </Button>
      {clicked && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Drag the button to your bookmarks bar, then click the bookmark on your
          Preply vocabulary page.
        </Alert>
      )}
    </Paper>
  )
}
