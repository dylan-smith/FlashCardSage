import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useSearchParams } from 'react-router'
import {
  appName,
  approveAuthorization,
  denyAuthorization,
  getAuthorizationRequest,
} from '../api/oauth'
import type { AuthorizationRequest } from '../api/oauth'
import { signOut, useSession } from '../auth/session'
import { navigateAway } from '../lib/navigateAway'
import { trackEvent } from '../telemetry'
import { useAction } from '../hooks/useAction'
import { useLoad } from '../hooks/useLoad'
import { Loading } from '../components/common/Loading'
import { Section } from '../components/common/Section'

// Why the API sent the user here instead of to an app's sign-in: the app, or where it asked to send the user back
// to, isn't one it knows, so it can't be trusted with an error.
const apiErrors: Record<string, string> = {
  invalid_client:
    "FlashCardSage doesn't know this app, so it can't connect. Try connecting it again from the app.",
  invalid_redirect_uri:
    "This app asked to send you back somewhere it hasn't registered, so it can't connect. Try connecting it again from the app.",
}

const badRequestMessage =
  "This link to connect an app doesn't work. Try connecting it again from the app."

const expiredMessage =
  'This request to connect an app has expired or has already been answered. Try connecting it again from the app.'

// Schemes that would run code on this page rather than go back to the app.
const unsafeSchemes = ['javascript:', 'data:', 'vbscript:']

function isSafeRedirect(url: string) {
  try {
    return !unsafeSchemes.includes(new URL(url).protocol)
  } catch {
    return false
  }
}

// The consent page an app's sign-in comes to (through the API's /oauth/authorize), where the signed-in user approves
// or denies the app's access to their cards. Either way the browser goes back to the app. A user who isn't signed in
// sees the sign-in page at this URL first, so the request is still here once they've signed in.
function AuthorizePage() {
  const [searchParams] = useSearchParams()
  const requestId = searchParams.get('request')
  const apiError = searchParams.get('error')

  if (apiError !== null || requestId === null) {
    return (
      <Section title="Connect an app">
        <Alert severity="error">
          {(apiError !== null && apiErrors[apiError]) || badRequestMessage}
        </Alert>
      </Section>
    )
  }

  return <Consent key={requestId} requestId={requestId} />
}

function Consent({ requestId }: { requestId: string }) {
  const session = useSession()
  const [errorMessage, setErrorMessage] = useState('')
  const {
    data: request,
    setData: setRequest,
    loading,
    failed,
  } = useLoad((signal) => getAuthorizationRequest(requestId, signal), [], {
    operation: 'loadAuthorization',
    fallback: 'Unable to load the request to connect an app.',
    onError: setErrorMessage,
  })
  // Stays busy once it's answered, while the browser goes back to the app.
  const answering = useAction(setErrorMessage)
  // What the user chose, once the browser is on its way back to the app.
  const [answered, setAnswered] = useState<'approved' | 'denied' | null>(null)

  async function handleAnswer(approve: boolean) {
    await answering.run(
      {
        operation: approve ? 'approveAuthorization' : 'denyAuthorization',
        fallback: 'Unable to answer the request to connect an app.',
        keepBusy: true,
      },
      async () => {
        const redirectUrl = approve
          ? await approveAuthorization(requestId)
          : await denyAuthorization(requestId)
        if (redirectUrl === null) {
          setRequest(null)
          return
        }
        if (!isSafeRedirect(redirectUrl)) {
          throw new Error("Refused to go back to the app's unsafe URL.")
        }
        trackEvent(approve ? 'AppApproved' : 'AppDenied')
        setAnswered(approve ? 'approved' : 'denied')
        navigateAway(redirectUrl)
      },
    )
  }

  return (
    <Section title="Connect an app">
      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
      )}
      {loading ? (
        <Loading />
      ) : failed ? null : request === null || request === undefined ? (
        <Alert severity="warning">{expiredMessage}</Alert>
      ) : answered !== null ? (
        <Alert severity="success">
          {answered === 'approved' ? 'Connected.' : 'Not connected.'} Going back
          to {request.redirectHost}. If the app doesn&apos;t open, you can close
          this page.
        </Alert>
      ) : (
        <ConsentDetails
          request={request}
          userName={session?.name ?? ''}
          busy={answering.busy}
          onAnswer={(approve) => void handleAnswer(approve)}
        />
      )}
    </Section>
  )
}

function ConsentDetails({
  request,
  userName,
  busy,
  onAnswer,
}: {
  request: AuthorizationRequest
  userName: string
  busy: boolean
  onAnswer: (approve: boolean) => void
}) {
  const { name, selfAsserted } = appName(request)

  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="p" sx={{ overflowWrap: 'anywhere' }}>
        <strong>{name}</strong>
        {selfAsserted && ' (a name the app gave itself)'} wants to read and
        change your flash cards.
      </Typography>
      <Typography>
        It will be able to see, add, change and delete your cards, tags and
        decks, and see your practice scores. You can disconnect it at any time
        from Preferences.
      </Typography>
      {selfAsserted && (
        <Typography color="text.secondary">
          Anyone can give an app this name, so only approve it if you just asked
          to connect it.
        </Typography>
      )}
      <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
        Either way, you&apos;ll go back to{' '}
        <strong>{request.redirectHost}</strong>.
      </Typography>
      <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
        Signed in as <strong>{userName}</strong>.{' '}
        <Link component="button" variant="body1" onClick={signOut}>
          Not you? Sign out
        </Link>
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button disabled={busy} onClick={() => onAnswer(false)}>
          Deny
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => onAnswer(true)}
        >
          Approve
        </Button>
      </Box>
    </Stack>
  )
}

export default AuthorizePage
