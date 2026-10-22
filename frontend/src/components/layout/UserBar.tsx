import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import SvgIcon from '@mui/material/SvgIcon'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { Link } from 'react-router'
import { signOut } from '../../auth/session'
import type { Session } from '../../auth/session'
import { useIsAdmin } from '../../hooks/useAdmin'
import { icons } from '../../lib/icons'
import { isAt } from './nav'

// The signed-in user, with links to the admin pages (for an admin) and their preferences, and a button to sign out.
export function UserBar({
  session,
  pathname,
}: {
  session: Session
  pathname: string
}) {
  const isAdmin = useIsAdmin()
  const atAdmin = isAt(pathname, { to: '/admin', label: 'Admin' })
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 1,
        mb: 1,
      }}
    >
      <Avatar
        src={session.pictureUrl}
        alt=""
        sx={{ width: 28, height: 28, fontSize: 14 }}
      >
        {session.name.charAt(0).toUpperCase()}
      </Avatar>
      <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
        {session.name}
      </Typography>
      {isAdmin && (
        <Tooltip title="Admin">
          <IconButton
            size="small"
            component={Link}
            to="/admin"
            aria-label="Admin"
            aria-current={atAdmin ? 'page' : undefined}
            color={atAdmin ? 'primary' : 'default'}
            sx={{ flexShrink: 0 }}
          >
            <SvgIcon fontSize="small">
              <path d={icons.admin} />
            </SvgIcon>
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Preferences">
        <IconButton
          size="small"
          component={Link}
          to="/preferences"
          aria-label="Preferences"
          aria-current={pathname === '/preferences' ? 'page' : undefined}
          color={pathname === '/preferences' ? 'primary' : 'default'}
          sx={{ flexShrink: 0 }}
        >
          <SvgIcon fontSize="small">
            <path d={icons.settings} />
          </SvgIcon>
        </IconButton>
      </Tooltip>
      <Button size="small" onClick={signOut} sx={{ flexShrink: 0 }}>
        Sign out
      </Button>
    </Box>
  )
}
