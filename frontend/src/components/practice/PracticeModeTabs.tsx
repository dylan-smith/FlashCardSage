import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import type { PracticeMode } from '../../hooks/usePracticeMode'

// Picks whether practice shows the cards or sentences made from them. There's one panel, which shows the mode picked
// (see TabPanel), so both tabs control it.
export function PracticeModeTabs({
  value,
  onChange,
}: {
  value: PracticeMode
  onChange: (mode: PracticeMode) => void
}) {
  return (
    <Tabs
      value={value}
      onChange={(_event, mode: PracticeMode) => onChange(mode)}
      aria-label="Practice mode"
    >
      <Tab
        value="cards"
        label="Cards"
        id="practice-tab-cards"
        aria-controls={`practice-panel-${value}`}
      />
      <Tab
        value="sentences"
        label="Sentences"
        id="practice-tab-sentences"
        aria-controls={`practice-panel-${value}`}
      />
    </Tabs>
  )
}
