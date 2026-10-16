import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Slide from '@mui/material/Slide'
import SvgIcon from '@mui/material/SvgIcon'
import { Link as RouterLink } from 'react-router'
import {
  clearToasts,
  dismissToast,
  getToasts,
  subscribeToasts,
  toastMs,
  toastWithActionMs,
} from './toasts'
import type { ShownToast } from './toasts'

// One toast, which slides down into place and back up when it goes: after its time, or sooner if the user closes it
// or follows its link. Its time stops while the pointer or focus is on it, so it can be read and its link reached.
function ToastItem({ toast }: { toast: ShownToast }) {
  const [open, setOpen] = useState(true)
  const [paused, setPaused] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!open || paused) {
      return
    }
    timer.current = window.setTimeout(
      () => setOpen(false),
      toast.action ? toastWithActionMs : toastMs,
    )
    return () => window.clearTimeout(timer.current)
  }, [open, paused, toast.action])

  return (
    <Slide
      direction="down"
      in={open}
      appear
      mountOnEnter
      unmountOnExit
      onExited={() => dismissToast(toast.id)}
    >
      <Alert
        severity={toast.severity}
        variant="filled"
        elevation={6}
        // Read out without interrupting, as the banners these replaced were.
        role="status"
        onClose={() => setOpen(false)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        // A link takes the place of the close button, so it's put back beside it.
        action={
          toast.action && (
            <>
              <Button
                component={RouterLink}
                to={toast.action.to}
                color="inherit"
                size="small"
                onClick={() => setOpen(false)}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {toast.action.label}
              </Button>
              <IconButton
                aria-label="Close"
                color="inherit"
                size="small"
                onClick={() => setOpen(false)}
              >
                <SvgIcon fontSize="small">
                  <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </SvgIcon>
              </IconButton>
            </>
          )
        }
        sx={{
          pointerEvents: 'auto',
          alignItems: 'center',
          // The filled info blue is too light for white text to read well.
          ...(toast.severity === 'info' && { bgcolor: 'info.dark' }),
        }}
      >
        {toast.message}
      </Alert>
    </Slide>
  )
}

// The toasts, stacked at the top of the page in the middle, newest at the bottom.
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts)

  // Toasts belong to the page that showed them, so none are left for whatever is shown next, such as the next test.
  useEffect(() => clearToasts, [])

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(600px, calc(100% - 32px))',
        zIndex: (theme) => theme.zIndex.snackbar,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        // Only the toasts themselves take clicks, not the space around them.
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </Box>
  )
}
