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
import { showToast } from '../toasts'
import type { WordSource } from '../wordSources/wordSources'

// A phone or tablet with only a touch screen, which has no bookmarks bar to drag the bookmarklet to.
export const touchOnlyQuery = '(hover: none) and (pointer: coarse)'

// Material icons for each step: a bookmark being added, a page opening, a mouse, and a list being checked.
const bookmarkAddIcon =
  'M21 7h-2v2h-2V7h-2V5h2V3h2v2h2v2zm-2 14-7-3-7 3V5c0-1.1.9-2 2-2h7c-.64.84-1 1.87-1 3 0 2.76 2.24 5 5 5 .34 0 .68-.03 1-.08V21z'
const openIcon =
  'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z'
const mouseIcon =
  'M13 1.07V9h7c0-4.08-3.05-7.44-7-7.93zM4 15c0 4.42 3.58 8 8 8s8-3.58 8-8v-4H4v4zm7-13.93C7.05 1.56 4 4.92 4 9h7V1.07z'
const checkListIcon =
  'M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z'

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

// How to bring in the user's words from a site, as four steps: drag its bookmarklet to the bookmarks bar, open the
// site, click it there, and pick the words to add. On a phone that can't be done, so it says to do it on a computer
// instead.
export function BookmarkletSteps({ source }: { source: WordSource }) {
  const { name, wordsName } = source
  const linkRef = useRef<HTMLAnchorElement>(null)
  // Read straight away, since the app is only rendered in the browser, so a phone doesn't show the steps first.
  const touchOnly = useMediaQuery(touchOnlyQuery, { noSsr: true })

  // React won't render a javascript: address, so it's set on the link itself.
  useEffect(() => {
    linkRef.current?.setAttribute(
      'href',
      source.bookmarkletHref(window.location.origin),
    )
  }, [source, touchOnly])

  if (touchOnly) {
    return (
      <Alert severity="info">
        Bringing in your {name} words needs a computer. It uses a bookmarklet
        you click on {name}&apos;s website, and phones and tablets don&apos;t
        have a bookmarks bar to add it to. Do this step on a computer, and the
        cards will be in your {name} deck here too.
      </Alert>
    )
  }

  return (
    <Box>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Bring in the words in your {name} {wordsName} as cards in your {name}{' '}
        deck:
      </Typography>
      <Stack
        component="ol"
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ listStyle: 'none', m: 0, p: 0 }}
      >
        <Step number={1} icon={bookmarkAddIcon} title="Add the bookmarklet">
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
              // It only works as a bookmark on the site.
              event.preventDefault()
              showToast({
                key: 'bookmarklet-hint',
                severity: 'info',
                message: `This button only works from your bookmarks bar. Drag it there, then click it on your ${name} ${wordsName} page.`,
              })
            }}
            sx={{ cursor: 'grab', mt: 'auto' }}
          >
            Send to FlashCardSage
          </Button>
        </Step>
        <Step number={2} icon={openIcon} title={`Open ${name}`}>
          <Typography variant="body2" color="text.secondary">
            Go to your {wordsName}, signed in to {name}.
          </Typography>
          <Link
            href={source.wordsUrl}
            target="_blank"
            rel="noreferrer"
            sx={{ mt: 'auto' }}
          >
            {name} {wordsName}
          </Link>
        </Step>
        <Step number={3} icon={mouseIcon} title="Click the bookmarklet">
          <Typography variant="body2" color="text.secondary">
            FlashCardSage opens here with your words.
          </Typography>
        </Step>
        <Step number={4} icon={checkListIcon} title="Pick and add">
          <Typography variant="body2" color="text.secondary">
            Change or remove any, then add them to your {name} deck. Words you
            already have are left out.
          </Typography>
        </Step>
      </Stack>
    </Box>
  )
}
