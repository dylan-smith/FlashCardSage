import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { Link } from 'react-router'
import { useCounts } from '../../hooks/useCounts'
import { isAt } from './nav'
import type { NavSection } from './nav'

// The sections of the mode labelled label, under the modes, with the one the user is on underlined and how many
// things each has.
export function SectionNav({
  label,
  sections,
  pathname,
}: {
  label: string
  sections: NavSection[]
  pathname: string
}) {
  const counts = useCounts()

  return (
    <Box
      component="nav"
      aria-label={label}
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 1,
        mt: -1,
        mb: 3,
      }}
    >
      {sections.map((section) => {
        const active = isAt(pathname, section)
        const count =
          section.count && counts ? counts[section.count] : undefined
        return (
          <Button
            key={section.to}
            component={Link}
            to={section.to}
            aria-current={active ? 'page' : undefined}
            sx={{
              borderRadius: 0,
              borderBottom: 2,
              borderColor: active ? 'primary.main' : 'transparent',
              fontWeight: active ? 'bold' : undefined,
            }}
          >
            {section.label}
            {/* The button lays out its content with flex, which drops the space, but it keeps the label and count
                apart for a screen reader. */}
            {count !== undefined && ' '}
            {count !== undefined && (
              <Box
                component="span"
                sx={{
                  ml: 0.75,
                  px: 0.75,
                  minWidth: 20,
                  borderRadius: 10,
                  bgcolor: 'action.selected',
                  color: 'text.secondary',
                  fontSize: 12,
                  lineHeight: '20px',
                }}
              >
                {count}
              </Box>
            )}
          </Button>
        )
      })}
    </Box>
  )
}
