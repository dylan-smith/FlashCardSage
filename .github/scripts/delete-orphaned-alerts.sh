#!/usr/bin/env bash
# Deletes the alert rules among the resources orphaned-resources.sh listed (a file of resource IDs, the first
# argument) and warns about the rest. An alert rule holds no data and the template recreates any it still
# defines, so one removed from alerts.bicep is safe to delete, and leaving it would keep it firing on whatever it
# was replaced for. Anything else may hold data, so it's left for a person to delete by hand or put back in the
# template. One failed deletion doesn't stop the others, and none fails the deployment.
set -euo pipefail

while IFS= read -r id; do
  [ -n "${id}" ] || continue
  resource="${id#*/providers/}"
  case "${id,,}" in
    */providers/microsoft.insights/metricalerts/* | \
      */providers/microsoft.insights/scheduledqueryrules/* | \
      */providers/microsoft.insights/activitylogalerts/* | \
      */providers/microsoft.alertsmanagement/smartdetectoralertrules/*)
      echo "Deleting ${resource}, which the template no longer defines"
      if ! az resource delete --ids "${id}" --output none; then
        echo "::warning::Couldn't delete the alert rule ${resource}, which the template no longer defines"
      fi
      ;;
    *)
      echo "::warning::${resource} is in the resource group but not in infra/main.bicep; delete it if it's no longer needed"
      ;;
  esac
done <"$1"
