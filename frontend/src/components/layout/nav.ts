import type { Counts } from '../../api/counts'

export type NavItem = { to: string; label: string }

// The parts of Manage cards, each with its own page. A deck's page is part of Decks. A section with a count shows
// how many of its things the user has.
export type NavSection = NavItem & { count?: keyof Counts }

// One of the app's modes, which may be made up of sections.
export type NavMode = NavItem & { sections?: NavSection[] }

const sections: NavSection[] = [
  { to: '/', label: 'Cards', count: 'cards' },
  { to: '/decks', label: 'Decks', count: 'decks' },
  { to: '/tags', label: 'Tags', count: 'tags' },
  { to: '/import', label: 'Import cards' },
]

// The app's modes. Manage cards is made up of the sections above.
export const modes: NavMode[] = [
  { to: '/', label: 'Manage cards', sections },
  { to: '/practice', label: 'Practice' },
  { to: '/scores', label: 'Scores' },
]

// Whether the path is the item's page or one under it. Every path is under /, so that one only matches itself.
export function isAt(pathname: string, { to }: NavItem) {
  return pathname === to || (to !== '/' && pathname.startsWith(`${to}/`))
}

// The mode the path is in, or none on a page that doesn't exist.
export function modeAt(pathname: string) {
  return modes.find((mode) =>
    (mode.sections ?? [mode]).some((item) => isAt(pathname, item)),
  )
}
