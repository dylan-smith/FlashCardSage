import type { Ref } from 'react'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import type { PracticeOutcome } from '../../api/flashCards'
import { outcomes } from './outcomes'

// A button for each outcome, the first of them given firstRef so it can be focused.
export function OutcomeButtons({
  firstRef,
  disabled,
  onAnswer,
}: {
  firstRef: Ref<HTMLButtonElement>
  disabled: boolean
  onAnswer: (outcome: PracticeOutcome) => void
}) {
  return (
    // In a row even on a phone, where they share its width, so they take up less of the screen's height.
    <Stack
      direction="row"
      spacing={1}
      sx={{ justifyContent: 'center', flexShrink: 0 }}
    >
      {outcomes.map(({ outcome, label, color }, index) => (
        <Button
          key={outcome}
          ref={index === 0 ? firstRef : undefined}
          type="button"
          variant="contained"
          color={color}
          disabled={disabled}
          onClick={() => onAnswer(outcome)}
          sx={{ flex: { xs: 1, sm: 'none' } }}
        >
          {label}
        </Button>
      ))}
    </Stack>
  )
}
