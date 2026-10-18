import { Fragment } from 'react'
import type { ReactNode } from 'react'
import Stack from '@mui/material/Stack'
import { useCardSelection } from '../../hooks/useCardSelection'
import type { CardSelectionKind } from '../../hooks/useCardSelection'
import { Loading } from '../common/Loading'
import { Section } from '../common/Section'
import { CardSelectionPicker } from './CardSelectionPicker'

// A page about every card, a deck's or a tag's, such as practice or scores: the picker, labelled label, and under it
// what children shows for the cards picked. While a deck or tag in the URL is being checked, a spinner shows instead.
// Children is shown again from the start for each choice, so it starts again, such as a new practice session.
export function CardSelectionPage({
  label,
  children,
}: {
  label: string
  children: (selection: {
    kind: CardSelectionKind
    deckId?: number
    tagId?: number
  }) => ReactNode
}) {
  const { choices, deck, tag, kind, value, waiting, select } =
    useCardSelection()

  return (
    <Stack spacing={2}>
      <CardSelectionPicker
        label={label}
        choices={choices}
        value={value}
        onSelect={select}
      />
      {waiting ? (
        <Section>
          <Loading />
        </Section>
      ) : (
        <Fragment key={value}>
          {children({ kind, deckId: deck?.id, tagId: tag?.id })}
        </Fragment>
      )}
    </Stack>
  )
}
