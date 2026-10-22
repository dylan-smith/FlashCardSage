import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

export type Stat = { label: string; value: number | string }

// Numbers side by side, each with what it counts under it, as many to a row as fit. A list of terms, so a screen
// reader reads each label with its number.
export function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    <Box
      component="dl"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
        gap: 1.5,
        m: 0,
      }}
    >
      {stats.map((stat) => (
        <Box
          key={stat.label}
          sx={{
            display: 'flex',
            flexDirection: 'column-reverse',
            justifyContent: 'flex-end',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            px: 1.5,
            py: 1,
          }}
        >
          {/* The label comes first for screen readers, and shows under the number. */}
          <Typography component="dt" variant="body2" color="text.secondary">
            {stat.label}
          </Typography>
          <Typography component="dd" variant="h6" sx={{ m: 0 }}>
            {stat.value}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}
