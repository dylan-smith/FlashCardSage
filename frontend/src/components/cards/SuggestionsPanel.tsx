import type { ReactNode } from 'react'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import Typography from '@mui/material/Typography'
import { useCollapsed } from '../../hooks/useCollapsed'
import type { SuggestionsState } from '../../hooks/useSuggestions'
import { EmptyText } from '../common/EmptyText'
import { Loading } from '../common/Loading'
import { Section } from '../common/Section'
import { SuggestionsHeading } from './SuggestionsHeading'

// A section of suggestions, such as suggested cards or tags, whose heading collapses it (remembered under
// collapsedKey). Under the description it shows a spinner while they load, failedText if they couldn't be, and the
// list (children) once they're ready, unless empty, with a button that asks for more. It isn't shown when suggestions
// aren't available. busy disables the button, such as while one is being added.
export function SuggestionsPanel({
  title,
  contentId,
  collapsedKey,
  description,
  state,
  failedText,
  empty,
  busy,
  onRefresh,
  children,
}: {
  title: string
  contentId: string
  collapsedKey: string
  description: ReactNode
  state: SuggestionsState<unknown>
  failedText: string
  empty: boolean
  busy: boolean
  onRefresh: () => void
  children: ReactNode
}) {
  const [collapsed, toggle] = useCollapsed(collapsedKey)

  if (state.status === 'unavailable') {
    return null
  }

  return (
    <Section>
      <SuggestionsHeading
        title={title}
        collapsed={collapsed}
        controls={contentId}
        onToggle={toggle}
      />
      <Collapse in={!collapsed} id={contentId} unmountOnExit>
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          {description}
        </Typography>
        {state.status === 'loading' ? (
          <Loading label="Loading suggestions" />
        ) : state.status === 'failed' ? (
          <EmptyText>{failedText}</EmptyText>
        ) : empty ? (
          <EmptyText>No suggestions right now.</EmptyText>
        ) : (
          children
        )}
        <Button
          type="button"
          size="small"
          disabled={state.status === 'loading' || busy}
          onClick={onRefresh}
          sx={{ mt: 1 }}
        >
          {state.status === 'failed' ? 'Try again' : 'More suggestions'}
        </Button>
      </Collapse>
    </Section>
  )
}
