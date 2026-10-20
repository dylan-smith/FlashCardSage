import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { trackException } from '../../telemetry'
import { emptyResponse, mockApi } from '../support/mockApi'
import { renderAt, renderLoaded, signInForEachTest } from '../support/render'

signInForEachTest()

describe('modes', () => {
  it('shows how many cards, decks and tags the user has', async () => {
    mockApi({ 'GET /counts': { cards: 12, decks: 3, tags: 1 } })
    renderAt('/')
    const sections = screen.getByRole('navigation', { name: 'Manage cards' })

    expect(
      await within(sections).findByRole('link', { name: 'Cards 12' }),
    ).toHaveAttribute('href', '/')
    expect(
      within(sections).getByRole('link', { name: 'Decks 3' }),
    ).toHaveAttribute('href', '/decks')
    expect(
      within(sections).getByRole('link', { name: 'Tags 1' }),
    ).toHaveAttribute('href', '/tags')
    expect(
      within(sections).getByRole('link', { name: 'Import cards' }),
    ).toHaveAttribute('href', '/import')
  })

  it("leaves the counts out when they can't be loaded", async () => {
    mockApi({ 'GET /counts': emptyResponse(500) })
    renderAt('/')

    await waitFor(() => {
      expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
        operation: 'refreshCounts',
      })
    })
    const sections = screen.getByRole('navigation', { name: 'Manage cards' })
    expect(
      within(sections).getByRole('link', { name: 'Cards' }),
    ).toBeInTheDocument()
  })

  it('links to each mode and marks the current one', async () => {
    const user = userEvent.setup()
    // No cards, so there's nothing to practice either.
    await renderLoaded('/')
    const nav = screen.getByRole('navigation', { name: 'Mode' })
    const hrefs = (links: HTMLElement[]) =>
      links.map((link) => link.getAttribute('href'))

    expect(hrefs(within(nav).getAllByRole('link'))).toEqual([
      '/',
      '/practice',
      '/scores',
    ])
    // Manage cards is the section the user is in, and Cards the page in it.
    expect(
      within(nav).getByRole('link', { name: 'Manage cards' }),
    ).toHaveAttribute('aria-current', 'true')
    const sections = screen.getByRole('navigation', { name: 'Manage cards' })
    expect(hrefs(within(sections).getAllByRole('link'))).toEqual([
      '/',
      '/decks',
      '/tags',
      '/import',
    ])
    expect(
      await within(sections).findByRole('link', { name: 'Cards 0' }),
    ).toHaveAttribute('aria-current', 'page')

    await user.click(within(sections).getByRole('link', { name: 'Tags 0' }))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Tags' }),
    ).toBeInTheDocument()
    expect(
      within(sections).getByRole('link', { name: 'Tags 0' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(sections).getByRole('link', { name: 'Cards 0' }),
    ).not.toHaveAttribute('aria-current')
    expect(
      within(nav).getByRole('link', { name: 'Manage cards' }),
    ).toHaveAttribute('aria-current', 'true')

    await user.click(within(nav).getByRole('link', { name: 'Practice' }))

    expect(
      await screen.findByText('There are no flash cards to practice yet.'),
    ).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Practice' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(nav).getByRole('link', { name: 'Manage cards' }),
    ).not.toHaveAttribute('aria-current')
    // Practice has no sections.
    expect(
      screen.queryByRole('navigation', { name: 'Manage cards' }),
    ).not.toBeInTheDocument()
  })
})
