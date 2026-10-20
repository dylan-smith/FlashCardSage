import {
  ApplicationInsights,
  DistributedTracingModes,
} from '@microsoft/applicationinsights-web'
import { apiBaseUrl } from './config'

type Properties = Record<string, string>

let appInsights: ApplicationInsights | undefined
// Set once the page starts going away, when the browser cancels its in-flight fetches.
let leavingPage = false

// Telemetry is only enabled when the build has a connection string (CI sets it for production), so local
// dev, unit tests and E2E runs send nothing.
export function initTelemetry() {
  const connectionString = import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING
  if (!connectionString || appInsights) {
    return
  }

  // This runs before the app mounts, so a bad configuration must leave telemetry off rather than stop the
  // page from rendering.
  try {
    const sdk = new ApplicationInsights({
      config: {
        connectionString,
        // W3C traceparent lets the API's OpenTelemetry pipeline continue the browser's trace.
        distributedTracingMode: DistributedTracingModes.W3C,
        enableCorsCorrelation: true,
        // Resolve against the page so a relative or empty base URL (same-origin API) still works.
        correlationHeaderDomains: [
          new URL(apiBaseUrl, window.location.origin).host,
        ],
        disableFetchTracking: false,
        enableUnhandledPromiseRejectionTracking: true,
        // App.tsx tracks a page view for each route the router renders, so the SDK doesn't watch history itself.
        enableAutoRouteTracking: false,
        // Chrome blocks the unload event by default and logs a permissions policy violation when it's hooked.
        // The SDK still flushes on pagehide, visibilitychange and beforeunload.
        disablePageUnloadEvents: ['unload'],
      },
    })
    sdk.addTelemetryInitializer((item) => {
      item.tags = { ...item.tags, 'ai.cloud.role': 'FlashCardSage.Web' }
    })
    sdk.loadAppInsights()
    // A fetch the app aborts itself, e.g. when a page unmounts or a newer request replaces it, fails with no status.
    // Nothing went wrong, so it isn't reported as a failed dependency. The SDK's own aborted flag only covers XHR, so
    // the request's signal is kept to check once it's done. The getter returns a new object when there's no context,
    // so it's assigned rather than changed in place.
    sdk.addDependencyListener((details) => {
      details.context = { ...details.context, signal: details.init?.signal }
    })
    sdk.addDependencyInitializer(({ item, context }) => {
      const signal = context?.signal as AbortSignal | null | undefined
      return !(item.responseCode === 0 && signal?.aborted)
    })
    appInsights = sdk
    window.addEventListener('pagehide', () => {
      leavingPage = true
    })
    // The back/forward cache can bring the page back.
    window.addEventListener('pageshow', () => {
      leavingPage = false
    })
  } catch (error) {
    console.error('Telemetry is disabled because it failed to start.', error)
  }
}

export function trackException(error: unknown, properties?: Properties) {
  // A fetch the browser cancelled because the user (or a test) navigated away or closed the page fails with a
  // TypeError ("Failed to fetch"). Nothing went wrong, so it isn't reported. Nor is one while the browser is offline,
  // when the app works from what's on the device and loads the rest once it's back.
  if ((leavingPage || !navigator.onLine) && error instanceof TypeError) {
    return
  }
  appInsights?.trackException({
    exception: error instanceof Error ? error : new Error(String(error)),
    properties,
  })
}

export function trackEvent(name: string, properties?: Properties) {
  appInsights?.trackEvent({ name, properties })
}

export function trackPageView() {
  appInsights?.trackPageView({ uri: window.location.href })
}

// Only for tests, so each one starts with telemetry uninitialized.
export function resetTelemetry() {
  appInsights = undefined
  leavingPage = false
}
