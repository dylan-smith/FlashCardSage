import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Connection } from '../../api/oauth'
import { unreachableMessage } from '../../api/client'
import { trackEvent } from '../../telemetry'
import { api } from '../support/factories'
import { emptyResponse, unreachable } from '../support/mockApi'
import type { Routes } from '../support/mockApi'
import { renderLoaded, signInForEachTest } from '../support/render'

signInForEachTest()

describe('connected apps', () => {
  const claude: Connection = {
    id: 3,
    clientName: 'Claude',
    clientHost: 'claude.ai',
    clientNameIsSelfAsserted: false,
    scopes: ['flashcards'],
    createdAt: '2026-10-18T09:00:00Z',
    lastUsedAt: '2026-10-20T10:30:00Z',
  }
  const cursor: Connection = {
    id: 2,
    clientName: 'Cursor',
    clientHost: null,
    clientNameIsSelfAsserted: true,
    scopes: ['flashcards'],
    createdAt: '2026-10-01T09:00:00Z',
    lastUsedAt: null,
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleDateString(undefined, {
      dateStyle: 'medium',
    })
  }

  function showConnections(routes: Routes = {}) {
    return renderLoaded('/preferences', {
      'GET /oauth/connections': [claude, cursor],
      ...routes,
    })
  }

  function connectedApps() {
    return screen.getByRole('list', { name: 'Connected apps' })
  }

  it('lists the apps the user has connected, with who vouches for them and when they were used', async () => {
    await showConnections()

    expect(
      screen.getByRole('heading', { level: 2, name: 'Connected apps' }),
    ).toBeInTheDocument()
    const items = within(connectedApps()).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('claude.ai')
    expect(items[0]).toHaveTextContent(
      `Calls itself Claude · Connected ${formatDate(claude.createdAt)} · Last used ${formatDate('2026-10-20T10:30:00Z')}`,
    )
    expect(items[1]).toHaveTextContent('Cursor')
    expect(items[1]).toHaveTextContent(
      `A name the app gave itself · Connected ${formatDate(cursor.createdAt)} · Not used yet`,
    )
  })

  it('says when the user has connected no apps', async () => {
    await showConnections({ 'GET /oauth/connections': [] })

    expect(
      screen.getByText(/You haven't connected any apps\./),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Connected apps' }),
    ).not.toBeInTheDocument()
  })

  it('disconnects an app once the user confirms', async () => {
    const user = userEvent.setup()
    const { calls } = await showConnections({
      'DELETE /oauth/connections/3': emptyResponse(204),
    })

    await user.click(
      screen.getByRole('button', { name: 'Disconnect claude.ai' }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Disconnect claude.ai?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))

    await screen.findByRole('button', { name: 'Disconnect Cursor' })
    expect(
      screen.queryByRole('button', { name: 'Disconnect claude.ai' }),
    ).not.toBeInTheDocument()
    expect(calls.find('DELETE')?.url).toBe(api('/oauth/connections/3'))
    expect(trackEvent).toHaveBeenCalledWith('AppDisconnected')
  })

  it('keeps the app when the user cancels', async () => {
    const user = userEvent.setup()
    const { calls } = await showConnections()

    await user.click(screen.getByRole('button', { name: 'Disconnect Cursor' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Disconnect Cursor?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(calls.some('DELETE')).toBe(false)
    expect(within(connectedApps()).getAllByRole('listitem')).toHaveLength(2)
  })

  it("shows an error when an app can't be disconnected", async () => {
    const user = userEvent.setup()
    await showConnections({
      'DELETE /oauth/connections/3': emptyResponse(500),
    })

    await user.click(
      screen.getByRole('button', { name: 'Disconnect claude.ai' }),
    )
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'Disconnect claude.ai?' }),
      ).getByRole('button', { name: 'Disconnect' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to disconnect the app.',
    )
    expect(within(connectedApps()).getAllByRole('listitem')).toHaveLength(2)
  })

  it("shows an error when the apps can't be loaded", async () => {
    await showConnections({ 'GET /oauth/connections': unreachable })

    expect(screen.getByRole('alert')).toHaveTextContent(unreachableMessage)
  })
})
