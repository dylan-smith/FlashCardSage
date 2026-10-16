import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// jsdom doesn't lay pages out, so it has no scrolling to do.
Element.prototype.scrollIntoView = () => {}

// Telemetry is off in tests, which check what it was told instead. telemetry.test.ts unmocks it to test the real one.
vi.mock('../telemetry', () => ({
  trackEvent: vi.fn(),
  trackException: vi.fn(),
  trackPageView: vi.fn(),
}))
