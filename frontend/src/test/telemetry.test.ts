import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import {
  initTelemetry,
  resetTelemetry,
  trackEvent,
  trackException,
  trackPageView,
} from '../telemetry'

type TelemetryItem = { tags?: Record<string, string> }
type DependencyContext = Record<string, unknown> | undefined
type DependencyListenerDetails = {
  init?: RequestInit
  context?: DependencyContext
}
type DependencyInitializerDetails = {
  item: { responseCode: number }
  context?: DependencyContext
}

const sdk = vi.hoisted(() => ({
  constructor: vi.fn<(options: { config: Record<string, unknown> }) => void>(),
  addTelemetryInitializer:
    vi.fn<(initializer: (item: TelemetryItem) => void) => void>(),
  loadAppInsights: vi.fn(),
  addDependencyListener:
    vi.fn<(listener: (details: DependencyListenerDetails) => void) => void>(),
  addDependencyInitializer:
    vi.fn<
      (initializer: (details: DependencyInitializerDetails) => boolean) => void
    >(),
  trackPageView: vi.fn(),
  trackException: vi.fn(),
  trackEvent: vi.fn(),
}))

const config = vi.hoisted(() => ({ apiBaseUrl: 'http://localhost:5269' }))

// The setup file mocks telemetry for every other test.
vi.unmock('../telemetry')

vi.mock('../config', () => ({
  get apiBaseUrl() {
    return config.apiBaseUrl
  },
}))

vi.mock('@microsoft/applicationinsights-web', () => ({
  DistributedTracingModes: { W3C: 2 },
  ApplicationInsights: class {
    constructor(options: { config: Record<string, unknown> }) {
      sdk.constructor(options)
    }
    addTelemetryInitializer = sdk.addTelemetryInitializer
    loadAppInsights = sdk.loadAppInsights
    addDependencyListener = sdk.addDependencyListener
    addDependencyInitializer = sdk.addDependencyInitializer
    trackPageView = sdk.trackPageView
    trackException = sdk.trackException
    trackEvent = sdk.trackEvent
  },
}))

// The browser says it's offline until the test ends.
function goOffline() {
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  onTestFinished(() => {
    onLine.mockRestore()
  })
}

// The config the SDK was created with.
function sdkConfig() {
  return sdk.constructor.mock.calls[0][0].config
}

// Runs a fetch with the given init and status through the dependency listener and initializer, and returns whether
// the dependency is reported.
function reportsDependency(init: RequestInit, responseCode: number) {
  const listener = sdk.addDependencyListener.mock.calls[0][0]
  const initializer = sdk.addDependencyInitializer.mock.calls[0][0]
  const details: DependencyListenerDetails = { init }
  listener(details)
  return initializer({ item: { responseCode }, context: details.context })
}

beforeEach(() => {
  resetTelemetry()
  config.apiBaseUrl = 'http://localhost:5269'
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('telemetry', () => {
  describe('without a connection string', () => {
    it('does not create the SDK and the helpers do nothing', () => {
      vi.stubEnv('VITE_APPINSIGHTS_CONNECTION_STRING', '')

      initTelemetry()
      trackEvent('Something')
      trackException(new Error('boom'))
      trackPageView()

      expect(sdk.constructor).not.toHaveBeenCalled()
      expect(sdk.trackEvent).not.toHaveBeenCalled()
      expect(sdk.trackException).not.toHaveBeenCalled()
      expect(sdk.trackPageView).not.toHaveBeenCalled()
    })
  })

  describe('with a connection string', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_APPINSIGHTS_CONNECTION_STRING', 'InstrumentationKey=abc')
    })

    it('uses W3C tracing and only correlates requests to the API', () => {
      initTelemetry()

      expect(sdkConfig()).toMatchObject({
        connectionString: 'InstrumentationKey=abc',
        distributedTracingMode: 2,
        enableCorsCorrelation: true,
        correlationHeaderDomains: ['localhost:5269'],
      })
      expect(sdk.loadAppInsights).toHaveBeenCalledOnce()
    })

    it('leaves page views to the router instead of tracking routes itself', () => {
      initTelemetry()

      expect(sdkConfig()).toMatchObject({ enableAutoRouteTracking: false })
      expect(sdk.trackPageView).not.toHaveBeenCalled()
    })

    it('tracks a page view for the current URL', () => {
      initTelemetry()
      window.history.pushState({}, '', '/cards/7')

      trackPageView()

      expect(sdk.trackPageView).toHaveBeenCalledWith({
        uri: `${window.location.origin}/cards/7`,
      })
      window.history.pushState({}, '', '/')
    })

    it.each(['', '/'])(
      'correlates with the page origin when the API base URL is %j',
      (apiBaseUrl) => {
        config.apiBaseUrl = apiBaseUrl

        initTelemetry()

        expect(sdkConfig()).toMatchObject({
          correlationHeaderDomains: [window.location.host],
        })
      },
    )

    it('does not hook the unload event', () => {
      initTelemetry()

      expect(sdkConfig()).toMatchObject({
        disablePageUnloadEvents: ['unload'],
      })
    })

    it('leaves telemetry off instead of throwing when setup fails', () => {
      config.apiBaseUrl = 'http://'
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      expect(() => initTelemetry()).not.toThrow()
      trackEvent('Something')

      expect(consoleError).toHaveBeenCalled()
      expect(sdk.trackEvent).not.toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it('sets the cloud role name on every item', () => {
      initTelemetry()

      const initializer = sdk.addTelemetryInitializer.mock.calls[0][0]
      const item = { tags: { existing: 'tag' } }
      initializer(item)

      expect(item.tags).toEqual({
        existing: 'tag',
        'ai.cloud.role': 'FlashCardSage.Web',
      })
    })

    it('does not report a fetch the app aborted', () => {
      initTelemetry()
      const controller = new AbortController()
      controller.abort()

      expect(reportsDependency({ signal: controller.signal }, 0)).toBe(false)
    })

    it('still reports a fetch that failed without being aborted', () => {
      initTelemetry()

      expect(
        reportsDependency({ signal: new AbortController().signal }, 0),
      ).toBe(true)
      expect(reportsDependency({}, 0)).toBe(true)
    })

    it('still reports a response that came back before the fetch was aborted', () => {
      initTelemetry()
      const controller = new AbortController()
      controller.abort()

      expect(reportsDependency({ signal: controller.signal }, 500)).toBe(true)
    })

    it('only initializes once', () => {
      initTelemetry()
      initTelemetry()

      expect(sdk.constructor).toHaveBeenCalledOnce()
    })

    it('forwards events and exceptions to the SDK', () => {
      initTelemetry()
      trackEvent('FlashCardCreated', { source: 'test' })
      trackException('not an error', { operation: 'load' })

      expect(sdk.trackEvent).toHaveBeenCalledWith({
        name: 'FlashCardCreated',
        properties: { source: 'test' },
      })
      expect(sdk.trackException).toHaveBeenCalledWith({
        exception: new Error('not an error'),
        properties: { operation: 'load' },
      })
    })

    it('ignores fetches the browser cancelled because the page is going away', () => {
      initTelemetry()
      window.dispatchEvent(new Event('pagehide'))
      trackException(new TypeError('Failed to fetch'), { operation: 'suggest' })

      expect(sdk.trackException).not.toHaveBeenCalled()
    })

    it('still reports other errors while the page is going away', () => {
      initTelemetry()
      window.dispatchEvent(new Event('pagehide'))
      const error = new Error('boom')
      trackException(error)

      expect(sdk.trackException).toHaveBeenCalledWith({
        exception: error,
        properties: undefined,
      })
    })

    it('ignores failed fetches while the browser is offline', () => {
      initTelemetry()
      goOffline()
      trackException(new TypeError('Failed to fetch'), { operation: 'load' })

      expect(sdk.trackException).not.toHaveBeenCalled()
    })

    it('still reports other errors while the browser is offline', () => {
      initTelemetry()
      goOffline()
      const error = new Error('boom')
      trackException(error)

      expect(sdk.trackException).toHaveBeenCalledWith({
        exception: error,
        properties: undefined,
      })
    })

    it('reports failed fetches again once the page comes back', () => {
      initTelemetry()
      window.dispatchEvent(new Event('pagehide'))
      window.dispatchEvent(new Event('pageshow'))
      const error = new TypeError('Failed to fetch')
      trackException(error)

      expect(sdk.trackException).toHaveBeenCalledWith({
        exception: error,
        properties: undefined,
      })
    })
  })
})
