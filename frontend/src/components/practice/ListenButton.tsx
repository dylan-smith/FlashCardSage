import { useEffect, useRef, useState } from 'react'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import SvgIcon from '@mui/material/SvgIcon'
import { describeFetchError } from '../../api/client'
import { icons } from '../../lib/icons'
import { reportFailure } from '../../lib/reportFailure'
import { useOnline } from '../../practice/online'
import {
  loadSpeech,
  playFailedMessage,
  playSpeech,
} from '../../practice/speech'
import type { Playback } from '../../practice/speech'

// Whether the browser refused to play audio the user didn't ask for, as it does before they've pressed anything on
// the page.
function isAutoplayRefused(error: unknown) {
  return error instanceof DOMException && error.name === 'NotAllowedError'
}

type Status = 'idle' | 'loading' | 'playing'

// Plays the card's Spanish: each word or phrase in turn, read by a natural voice. The audio is asked for as soon as
// the card comes up (see PracticeSession), so pressing Listen usually plays at once; while it's still being fetched
// the button shows a spinner, and while it plays the button stops it instead. With autoPlay it also plays as soon as
// it's shown, unless the browser won't let it, which needs no error since the user can press it. The audio comes from
// the API, so the button is off while the browser is offline.
//
// With withSlow there's a Listen slowly button beside it, which has the voice say the Spanish slowly, for when it's
// too fast to make out. Its audio is only fetched when it's pressed. The two share one playback, so pressing either
// stops the other.
export function ListenButton({
  texts,
  onError,
  autoPlay = false,
  large = false,
  withSlow = false,
}: {
  texts: string[]
  onError: (message: string) => void
  autoPlay?: boolean
  large?: boolean
  withSlow?: boolean
}) {
  const online = useOnline()
  // A button that plays by itself starts out fetching the audio. slow is which button the status is for.
  const [state, setState] = useState<{ status: Status; slow: boolean }>(() => ({
    status: autoPlay && online ? 'loading' : 'idle',
    slow: false,
  }))
  const playbackRef = useRef<Playback | null>(null)
  // Counts each play and the button going away, so audio that arrives after either is never played.
  const runRef = useRef(0)

  // Whatever's playing stops with the card.
  useEffect(
    () => () => {
      runRef.current++
      playbackRef.current?.stop()
    },
    [],
  )

  async function play(automatic: boolean, slow: boolean) {
    const run = ++runRef.current
    const current = () => runRef.current === run
    // The other button's audio stops, and since this is now the current play, its ending changes nothing.
    playbackRef.current?.stop()
    playbackRef.current = null
    if (!automatic) {
      setState({ status: 'loading', slow })
    }
    try {
      const urls = await loadSpeech(texts, slow)
      if (!current()) {
        return
      }
      const playback = playSpeech(urls)
      playbackRef.current = playback
      setState({ status: 'playing', slow })
      await playback.done
    } catch (error) {
      if (current() && !(automatic && isAutoplayRefused(error))) {
        reportFailure(error, 'speech')
        onError(describeFetchError(error, playFailedMessage))
      }
    } finally {
      if (current()) {
        playbackRef.current = null
        setState({ status: 'idle', slow: false })
      }
    }
  }

  // Once, when the card comes up.
  useEffect(() => {
    if (autoPlay && online) {
      // Its state only changes once the audio has arrived, since it starts out fetching it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void play(true, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleClick(slow: boolean) {
    const mine = state.status !== 'idle' && state.slow === slow
    if (mine && state.status === 'playing') {
      playbackRef.current?.stop()
    } else if (!mine) {
      void play(false, slow)
    }
  }

  function button(slow: boolean) {
    const status = state.slow === slow ? state.status : 'idle'
    const playing = status === 'playing'
    return (
      <IconButton
        color="primary"
        size={large ? 'large' : 'medium'}
        aria-label={playing ? 'Stop' : slow ? 'Listen slowly' : 'Listen'}
        aria-busy={status === 'loading'}
        disabled={!online}
        onClick={() => handleClick(slow)}
        sx={{ flexShrink: 0 }}
      >
        {status === 'loading' ? (
          <CircularProgress size={large ? 48 : 24} color="inherit" />
        ) : (
          <SvgIcon sx={large ? { fontSize: 48 } : undefined}>
            <path d={icons[playing ? 'stop' : slow ? 'slow' : 'volumeUp']} />
          </SvgIcon>
        )}
      </IconButton>
    )
  }

  return (
    <>
      {button(false)}
      {withSlow && button(true)}
    </>
  )
}
