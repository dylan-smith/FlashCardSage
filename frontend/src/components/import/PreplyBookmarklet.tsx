import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { icons } from '../../lib/icons'
import { bookmarkletHref } from '../../preply/sendToFlashCardSage'
import { showToast } from '../../toasts'

export const preplyVocabularyUrl =
  'https://preply.com/en/practice/vocab-bank?subject=spanish'

// A phone or tablet with only a touch screen, which has no bookmarks bar to drag the bookmarklet to.
export const touchOnlyQuery = '(hover: none) and (pointer: coarse)'

// One step, as a card with its number and icon, a short title, a line saying what to do, and anything to do it with.
// The number is only drawn, since the list it's in numbers the steps for a screen reader.
function Step({
  number,
  icon,
  title,
  children,
}: {
  number: number
  icon: string
  title: string
  children: ReactNode
}) {
  return (
    <Paper
      component="li"
      variant="outlined"
      sx={{
        flex: 1,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 1,
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'relative',
          width: 48,
          height: 48,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SvgIcon>
          <path d={icon} />
        </SvgIcon>
        <Box
          component="span"
          sx={{
            position: 'absolute',
            top: -4,
            right: -4,
            width: 22,
            height: 22,
            borderRadius: '50%',
            bgcolor: 'secondary.main',
            color: 'secondary.contrastText',
            fontSize: 12,
            fontWeight: 'bold',
            lineHeight: '22px',
          }}
        >
          {number}
        </Box>
      </Box>
      <Typography component="h2" sx={{ fontWeight: 'bold' }}>
        {title}
      </Typography>
      {children}
    </Paper>
  )
}

// How to bring in the user's Preply vocabulary, as four steps: drag the bookmarklet to the bookmarks bar, open Preply,
// click it there, and pick the words to add. On a phone that can't be done, so it says to do it on a computer instead.
export function PreplyBookmarklet() {
  const linkRef = useRef<HTMLAnchorElement>(null)
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
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Bring in the words in your Preply vocabulary as cards in your Preply
        deck:
      </Typography>
      <Stack
        component="ol"
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ listStyle: 'none', m: 0, p: 0 }}
      >
        <Step number={1} icon={icons.bookmarkAdd} title="Add the bookmarklet">
          <Typography variant="body2" color="text.secondary">
            Drag this button to your bookmarks bar.
          </Typography>
          <Button
            component="a"
            ref={linkRef}
            // Replaced with the bookmarklet once rendered. Without an address, it isn't a link.
            href="#send-to-flashcardsage"
            variant="contained"
            onClick={(event: React.MouseEvent) => {
              // It only works as a bookmark on Preply.
              event.preventDefault()
              showToast({
                key: 'bookmarklet-hint',
                severity: 'info',
                message:
                  'This button only works from your bookmarks bar. Drag it there, then click it on your Preply vocabulary page.',
              })
            }}
            sx={{ cursor: 'grab', mt: 'auto' }}
          >
            Send to FlashCardSage
          </Button>
        </Step>
        <Step number={2} icon={icons.open} title="Open Preply">
          <Typography variant="body2" color="text.secondary">
            Go to your vocabulary, signed in to Preply.
          </Typography>
          <Link
            href={preplyVocabularyUrl}
            target="_blank"
            rel="noreferrer"
            sx={{ mt: 'auto' }}
          >
            Preply vocabulary
          </Link>
        </Step>
        <Step number={3} icon={icons.mouse} title="Click the bookmarklet">
          <Typography variant="body2" color="text.secondary">
            FlashCardSage opens here with your words.
          </Typography>
        </Step>
        <Step number={4} icon={icons.checkList} title="Pick and add">
          <Typography variant="body2" color="text.secondary">
            Change or remove any, then add them to your Preply deck. Words you
            already have are left out.
          </Typography>
        </Step>
      </Stack>
    </Box>
  )
}
