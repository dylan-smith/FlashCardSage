import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router'
import { Section } from '../components/common/Section'

const issuesUrl = 'https://github.com/dylan-smith/FlashCardSage/issues'

function Topic({
  id,
  title,
  children,
}: {
  id?: string
  title: string
  children: ReactNode
}) {
  return (
    <Box id={id} sx={{ mt: 3, scrollMarginTop: 16 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

function Text({ children }: { children: ReactNode }) {
  return <Typography sx={{ mb: 1 }}>{children}</Typography>
}

// What the app keeps about a user, who else sees it and how to delete it. Anyone can read it, signed in or not: the
// Android app's store listing links here, and to #delete-account for how to delete an account.
function PrivacyPage({ signedIn }: { signedIn: boolean }) {
  return (
    <Section title="Privacy policy">
      <Typography color="text.secondary">
        Last updated 19 November 2026. This covers FlashCardSage at
        flashcardsage.com and the FlashCardSage Android app, which shows the
        same site.
      </Typography>

      <Topic title="What FlashCardSage keeps">
        <Text>
          Your account: when you sign in with Google, FlashCardSage gets your
          name, email address and profile picture from Google. It keeps your
          name, your email address, Google&apos;s ID for your account, when you
          first signed in and when you last used the app. It never sees your
          Google password.
        </Text>
        <Text>
          What you make: your flash cards, tags, decks, the pictures on your
          cards, your preferences, and your practice answers, which your scores
          come from.
        </Text>
        <Text>
          Apps you connect: if you connect an AI assistant, FlashCardSage keeps
          which app it is and when it was connected and last used, until you
          disconnect it.
        </Text>
        <Text>
          On your device: the app keeps your sign-in, a copy of your cards and
          any practice answers not yet saved, so practice works offline.
        </Text>
      </Topic>

      <Topic title="How it's used">
        <Text>
          Only to run the app for you. Your cards are yours alone: other users
          can&apos;t see them. FlashCardSage has no ads and doesn&apos;t sell or
          share your data for advertising.
        </Text>
        <Text>
          The app records how it&apos;s used and the errors it runs into (pages
          opened, actions such as adding a card, and failures), with your
          account&apos;s ID, to keep it working and improve it. It sets two
          cookies to count visitors and visits.
        </Text>
      </Topic>

      <Topic title="Who else handles it">
        <Text>
          FlashCardSage runs on Microsoft Azure in the United States, and
          Microsoft&apos;s services do the work behind some features. The words
          on your cards are sent to them to translate a card, suggest cards and
          tags, write practice sentences, make a picture and read Spanish aloud.
          A document you upload to scan for cards is sent to be read, and
          isn&apos;t kept. Your name and email address aren&apos;t sent with any
          of these.
        </Text>
        <Text>
          Translations, generated pictures and spoken audio are kept so the same
          words needn&apos;t be made again, with nothing that says whose they
          were.
        </Text>
        <Text>
          Card pictures are stored at web addresses that are long and random but
          not private: anyone who has a picture&apos;s address can open it.
        </Text>
        <Text>
          Google handles sign-in, and Cloudflare carries the site&apos;s
          traffic.
        </Text>
      </Topic>

      <Topic id="delete-account" title="Deleting your account">
        <Text>
          Sign in at flashcardsage.com or in the Android app, open Preferences
          (the cog at the top) and choose Delete account. Your account, cards,
          the pictures you uploaded, tags, decks, practice history and connected
          apps are deleted straight away, and can&apos;t be brought back.
        </Text>
        <Text>
          Translations, generated pictures and audio that aren&apos;t tied to
          you stay. Records of how the app was used are kept for up to 90 days,
          and backups of the database for up to 30 days. You can also delete
          single cards, tags and decks at any time.
        </Text>
      </Topic>

      <Topic title="Questions">
        <Text>
          Ask at{' '}
          <Link href={issuesUrl} target="_blank" rel="noreferrer">
            github.com/dylan-smith/FlashCardSage/issues
          </Link>
          . If this policy changes, the date at the top changes with it.
        </Text>
      </Topic>

      {!signedIn && (
        <Button
          component={RouterLink}
          to="/"
          variant="contained"
          sx={{ mt: 2 }}
        >
          Back to FlashCardSage
        </Button>
      )}
    </Section>
  )
}

export default PrivacyPage
