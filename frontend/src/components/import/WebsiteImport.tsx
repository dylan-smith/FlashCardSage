import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import { wordSources } from '../../wordSources/wordSources'
import type { WordSource } from '../../wordSources/wordSources'
import { WordSourceImport } from './WordSourceImport'

// The Import cards page's website tab: the sites the user's words can be brought in from, as buttons to pick one, and
// the picked site's bookmarklet steps and words below them. Every site's panel stays mounted, so words half looked
// over are still there after a look at another site. active is whether the tab is showing, so only the picked site's
// notices show, and only while it is.
export function WebsiteImport({
  picked,
  onPick: pick,
  active,
}: {
  picked: WordSource
  onPick: (source: WordSource) => void
  active: boolean
}) {
  return (
    <Stack spacing={2}>
      <Box
        role="group"
        aria-label="Website"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        {wordSources.map((source) => (
          <Chip
            key={source.id}
            label={source.name}
            color={picked.id === source.id ? 'primary' : 'default'}
            variant={picked.id === source.id ? 'filled' : 'outlined'}
            aria-pressed={picked.id === source.id}
            onClick={() => pick(source)}
          />
        ))}
      </Box>
      {wordSources.map((source) => (
        <Box
          key={source.id}
          role="region"
          aria-label={`From ${source.name}`}
          hidden={picked.id !== source.id}
        >
          <WordSourceImport
            source={source}
            active={active && picked.id === source.id}
          />
        </Box>
      ))}
    </Stack>
  )
}
