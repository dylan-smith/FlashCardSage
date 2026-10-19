#!/usr/bin/env bash
# Sends a custom event marking the API paused or resumed for a deployment to Application Insights, where it lands
# in the workspace's AppEvents table. The browser alerts in infra/modules/alerts.bicep leave out the failures
# between a run's ApiPaused and ApiResumed events (plus a few minutes for the API to come back), since the API is
# meant to be unreachable then. ApiResumed carries the pause time, so an alert window that starts after the pause
# still sees when it began.
#
# Usage: track-deploy-event.sh ApiPaused|ApiResumed
# Requires APPINSIGHTS_CONNECTION_STRING and, for ApiResumed, PAUSED_AT (the time output of the ApiPaused call).
# Outputs time, the event's timestamp.
set -euo pipefail

name="$1"
if [ "${name}" != "ApiPaused" ] && [ "${name}" != "ApiResumed" ]; then
  echo "::error::Expected ApiPaused or ApiResumed, got '${name}'"
  exit 1
fi

ikey="$(tr ';' '\n' <<<"${APPINSIGHTS_CONNECTION_STRING}" | sed -n 's/^InstrumentationKey=//p')"
endpoint="$(tr ';' '\n' <<<"${APPINSIGHTS_CONNECTION_STRING}" | sed -n 's/^IngestionEndpoint=//p')"
endpoint="${endpoint%/}"
if [ -z "${ikey}" ] || [ -z "${endpoint}" ]; then
  echo "::error::The connection string has no InstrumentationKey or IngestionEndpoint"
  exit 1
fi

time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
properties="\"RunId\":\"${GITHUB_RUN_ID:-local}\""
if [ "${name}" = "ApiResumed" ]; then
  properties="${properties},\"PausedAt\":\"${PAUSED_AT}\""
fi
body="{\"name\":\"Microsoft.ApplicationInsights.Event\",\"time\":\"${time}\",\"iKey\":\"${ikey}\",\"data\":{\"baseType\":\"EventData\",\"baseData\":{\"ver\":2,\"name\":\"${name}\",\"properties\":{${properties}}}}}"

echo "Sending ${name} at ${time}"
curl --silent --show-error --fail --max-time 30 \
  --header 'Content-Type: application/json' \
  --data "${body}" \
  "${endpoint}/v2/track"
echo
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "time=${time}" >>"$GITHUB_OUTPUT"
fi
