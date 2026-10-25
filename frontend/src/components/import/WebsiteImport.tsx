import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Stack from '@mui/material/Stack'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'
import { wordSources } from '../../wordSources/wordSources'
import type { WordSource } from '../../wordSources/wordSources'
import { WordSourceImport } from './WordSourceImport'

// A site as a tile to pick it with: its logo, its name and what it calls the words, outlined in the app's colour when
// picked. Its name and what it calls the words are its label for a screen reader, as they are what it shows.
function SiteTile({
  source,
  picked,
  onPick: pick,
}: {
  source: WordSource
  picked: boolean
  onPick: () => void
}) {
  const nameId = `website-${source.id}-name`
  const wordsId = `website-${source.id}-words`
  return (
    <ButtonBase
      aria-pressed={picked}
      aria-labelledby={`${nameId} ${wordsId}`}
      onClick={pick}
      sx={{
        display: 'flex',
        justifyContent: 'flex-start',
        gap: 1.5,
        p: 1.5,
        textAlign: 'left',
        borderRadius: 2,
        border: 2,
        borderColor: picked ? 'primary.main' : 'divider',
        bgcolor: picked ? 'action.selected' : 'background.paper',
        transition: (theme) =>
          theme.transitions.create(['border-color', 'background-color']),
        '&:hover': { borderColor: picked ? 'primary.main' : 'text.secondary' },
      }}
    >
      <Box
        aria-hidden
        sx={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: 1.5,
          bgcolor: source.logo.color,
          color: 'common.white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SvgIcon viewBox={source.logo.viewBox} sx={{ fontSize: 26 }}>
          <path d={source.logo.path} />
        </SvgIcon>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography id={nameId} component="span" sx={{ fontWeight: 'bold' }}>
          {source.name}
        </Typography>
        {/* Keeps the name and the words apart in the tile's text, as they are in its label. */}{' '}
        <Typography id={wordsId} variant="body2" color="text.secondary">
          Your {source.wordsName}
        </Typography>
      </Box>
    </ButtonBase>
  )
}

// The Import cards page's website tab: the sites the user's words can be brought in from, as tiles to pick one, and
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
      {/* As many tiles to a row as fit: one on a phone, three or four on a wide screen. */}
      <Box
        role="group"
        aria-label="Website"
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(auto-fill, minmax(150px, 1fr))',
            sm: 'repeat(auto-fill, minmax(220px, 1fr))',
          },
          gap: 1.5,
        }}
      >
        {wordSources.map((source) => (
          <SiteTile
            key={source.id}
            source={source}
            picked={picked.id === source.id}
            onPick={() => pick(source)}
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
