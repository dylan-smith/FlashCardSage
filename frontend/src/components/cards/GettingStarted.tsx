import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'
import { Link } from 'react-router'
import type { Counts } from '../../api/counts'
import { useSession } from '../../auth/session'
import { useCounts } from '../../hooks/useCounts'
import { useChangePreference, usePreferences } from '../../hooks/usePreferences'
import { icons } from '../../lib/icons'
import { Section } from '../common/Section'

// The steps to getting going, each with a link to where it's done. done says whether the user has done it, from their
// counts: once they have a card, and once they've answered in practice. Looking at the scores leaves no sign, so that
// step only points the way.
const steps: {
  title: string
  description: string
  to: string
  link: string
  done: (counts: Counts) => boolean
}[] = [
  {
    title: 'Get some cards',
    description: 'Add a built-in deck, or type a card in below.',
    to: '/import',
    link: 'Pick a built-in deck',
    done: (counts) => counts.cards > 0,
  },
  {
    title: 'Practice them',
    description:
      'Reveal a card, then say how it went. Your scores pick what comes up next.',
    to: '/practice',
    link: 'Quiz yourself',
    done: (counts) => counts.practiced > 0,
  },
  {
    title: "See how you're doing",
    description: "Each card's score shows which ones need work.",
    to: '/scores',
    link: 'Check your progress',
    done: () => false,
  },
]

// The user's first name, to welcome them by, or nothing when the sign-in gave no name.
function firstName(name: string | undefined) {
  return name?.trim().split(/\s+/)[0] ?? ''
}

// A guide to getting going for a new user, at the top of the cards page: the steps above, ticked off as the user
// does them, and a word about what else there is. It's shown while the showGettingStarted preference is on, which
// Hide guide turns off (and the preferences page turns back on). Nothing is shown until the preferences have loaded,
// so a user who hid it doesn't see it flash up. onError is told when hiding it couldn't be saved.
export function GettingStarted({
  onError,
}: {
  onError: (message: string) => void
}) {
  const preferences = usePreferences()
  const counts = useCounts()
  const session = useSession()
  const changePreference = useChangePreference(onError)

  if (preferences?.showGettingStarted !== true) {
    return null
  }

  const done = steps.map((step) => counts !== null && step.done(counts))
  // Once the user has cards and has practiced, there's nothing left to tick off.
  const allSet = done[0] && done[1]
  const name = firstName(session?.name)
  const greeting = `${allSet ? "You're all set" : 'Welcome'}${name && `, ${name}`}!`

  return (
    <Section title="Getting started">
      <Stack spacing={2}>
        <Typography>
          {allSet
            ? `${greeting} Here's where to go from here.`
            : `${greeting} Here's how to get going.`}
        </Typography>
        {steps.map((step, index) => (
          <Box key={step.to} sx={{ display: 'flex', gap: 1.5 }}>
            {/* The tick says whether the step's done, for a screen reader too. */}
            <SvgIcon
              titleAccess={done[index] ? 'Done' : 'To do'}
              color={done[index] ? 'success' : 'action'}
              sx={{ mt: 0.25, flexShrink: 0 }}
            >
              <path d={done[index] ? icons.checkCircle : icons.circle} />
            </SvgIcon>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 'bold' }}>{step.title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {step.description}
              </Typography>
              <Button
                component={Link}
                to={step.to}
                variant="outlined"
                size="small"
                sx={{ mt: 1 }}
              >
                {step.link}
              </Button>
            </Box>
          </Box>
        ))}
        <Typography variant="body2" color="text.secondary">
          More to explore: ask for a picture of what a card means, press Listen
          in practice to hear its Spanish, sort your cards with tags and decks,
          add the cards suggested for you, import a document or your Preply or
          Duolingo words, or connect an AI assistant to your cards. The cog at
          the top right has your preferences.
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="button"
            size="small"
            onClick={() =>
              changePreference(
                'showGettingStarted',
                false,
                'GettingStartedHidden',
              )
            }
          >
            Hide guide
          </Button>
        </Box>
      </Stack>
    </Section>
  )
}
