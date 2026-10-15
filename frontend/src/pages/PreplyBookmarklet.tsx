import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { bookmarkletHref } from '../preply/sendToFlashCardSage'

export const preplyVocabularyUrl =
  'https://preply.com/en/practice/vocab-bank?subject=spanish'

// A phone or tablet with only a touch screen, which has no bookmarks bar to drag the bookmarklet to.
export const touchOnlyQuery = '(hover: none) and (pointer: coarse)'

// How to bring in the user's Preply vocabulary: a bookmarklet they drag to their bookmarks bar and click on Preply. On a
// phone that can't be done, so it says to do it on a computer instead.
export function PreplyBookmarklet() {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const [clicked, setClicked] = useState(false)
  // Read straight away, since the app is only rendered in the browser, so a phone doesn't show the steps first.
  const touchOnly = useMediaQuery(touchOnlyQuery, { noSsr: true })

  // React won't render a javascript: address, so it's set on the link itself.
  useEffect(() => {
    linkRef.current?.setAttribute(
      'href',
      bookmarkletHref(window.location.origin),
    )
  }, [touchOnly])

  if (touchOnly) {
    return (
      <Alert severity="info">
        Bringing in your Preply words needs a computer. It uses a bookmarklet
        you click on Preply&apos;s website, and phones and tablets don&apos;t
        have a bookmarks bar to add it to. Do this step on a computer, and the
        cards will be in your Preply deck here too.
      </Alert>
    )
  }

  return (
    <Box>
      <Typography color="text.secondary" component="div" sx={{ mb: 2 }}>
        Bring in the words in your Preply vocabulary as cards in your Preply
        deck:
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
            Click the bookmark. FlashCardSage opens here with your words to pick
            from. Words you already have cards for are left out.
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
    </Box>
  )
}
