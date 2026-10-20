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
import { icons } from '../../lib/icons'

// The signed-in user, with a link to their preferences and a button to sign out.
export function UserBar({
  session,
  pathname,
}: {
  session: Session
  pathname: string
}) {
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
