import SvgIcon from '@mui/material/SvgIcon'

// A down arrow for a button that shows and hides something, turned to point right while it's hidden.
export function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <SvgIcon
      sx={{
        transform: expanded ? 'none' : 'rotate(-90deg)',
        transition: 'transform 150ms',
      }}
    >
      <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
    </SvgIcon>
  )
}
