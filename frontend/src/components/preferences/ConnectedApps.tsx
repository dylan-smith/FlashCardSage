import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import { appName, disconnectApp, getConnections } from '../../api/oauth'
import type { Connection } from '../../api/oauth'
import { trackEvent } from '../../telemetry'
import { useAction } from '../../hooks/useAction'
import { useConfirm } from '../../hooks/useConfirm'
import { useLoad } from '../../hooks/useLoad'
import { AnimatedList, AnimatedListItem } from '../common/AnimatedList'
import { ConfirmDelete } from '../common/ConfirmDelete'
import { EmptyText } from '../common/EmptyText'
import { Loading } from '../common/Loading'

function formatDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

// Who vouches for the app, or that it named itself, then when it was connected and last used.
function details(connection: Connection) {
  const { selfAsserted } = appName(connection)
  const vouchedName =
    connection.clientHost !== null && connection.clientName !== null
      ? `Calls itself ${connection.clientName}`
      : null
  return [
    selfAsserted ? 'A name the app gave itself' : vouchedName,
    `Connected ${formatDate(connection.createdAt)}`,
    connection.lastUsedAt === null
      ? 'Not used yet'
      : `Last used ${formatDate(connection.lastUsedAt)}`,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

// The apps, such as an AI assistant, the user has let read and change their cards, each of which they can disconnect.
export function ConnectedApps() {
  const [errorMessage, setErrorMessage] = useState('')
  const {
    data: connections,
    setData: setConnections,
    loading,
    failed,
  } = useLoad((signal) => getConnections(signal), [], {
    operation: 'loadConnections',
    fallback: 'Unable to load connected apps.',
    onError: setErrorMessage,
    initial: [] as Connection[],
  })
  // The connection being disconnected, so its buttons can wait for the API.
  const disconnecting = useAction<number>(setErrorMessage)
  // The connection whose Disconnect was clicked, while the user is asked whether they mean it.
  const confirm = useConfirm<Connection>()
  const confirming = confirm.target

  async function handleDisconnect(connection: Connection) {
    await disconnecting.run(
      {
        operation: 'disconnectApp',
        fallback: 'Unable to disconnect the app.',
        key: connection.id,
        reportAll: true,
      },
      async () => {
        await disconnectApp(connection.id)
        trackEvent('AppDisconnected')
        setConnections((current) =>
          current.filter((item) => item.id !== connection.id),
        )
      },
    )
    confirm.close()
  }

  return (
    <>
      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
      )}
      {loading ? (
        <Loading />
      ) : failed ? null : connections.length === 0 ? (
        <EmptyText>
          You haven&apos;t connected any apps. An AI assistant you connect to
          FlashCardSage shows up here, so you can disconnect it.
        </EmptyText>
      ) : (
        <AnimatedList disablePadding aria-label="Connected apps">
          {connections.map((connection) => {
            const { name } = appName(connection)
            return (
              <AnimatedListItem key={connection.id}>
                <ListItem
                  component="div"
                  divider
                  disablePadding
                  sx={{ py: 1, gap: 1 }}
                >
                  <ListItemText
                    primary={name}
                    secondary={details(connection)}
                    sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                  />
                  <Button
                    color="error"
                    aria-label={`Disconnect ${name}`}
                    disabled={disconnecting.busyKey === connection.id}
                    onClick={() => confirm.ask(connection)}
                    sx={{ flexShrink: 0 }}
                  >
                    Disconnect
                  </Button>
                </ListItem>
              </AnimatedListItem>
            )
          })}
        </AnimatedList>
      )}
      {confirming !== null && (
        <ConfirmDelete
          {...confirm.dialogProps}
          title={`Disconnect ${appName(confirming).name}?`}
          confirmText="Disconnect"
          busyText="Disconnecting…"
          busy={disconnecting.busyKey === confirming.id}
          onConfirm={() => void handleDisconnect(confirming)}
        >
          It won&apos;t be able to read or change your flash cards any more.
          Your cards stay as they are, and you can connect it again from the
          app.
        </ConfirmDelete>
      )}
    </>
  )
}
