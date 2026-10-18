#!/usr/bin/env bash
# Lists the resources in the production resource group that infra/main.bicep no longer defines, one resource ID
# per line. A deployment only adds and updates what the template declares, so a resource removed from it stays
# behind, and an alert rule keeps firing (the metric alert the log-based "browser errors" rule replaced fired on
# the CI smoke tests for days). What-if reports such resources as "Ignore", which is what this lists, leaving out
# what the template never owned: the managed identities Setup-Environment.ps1 creates and the SQL server's master
# database.
# Requires AZURE_RESOURCE_GROUP and the environment variables infra/main.bicepparam reads, and runs from the
# repository root. WHAT_IF_VALIDATION_LEVEL defaults to Provider; the PR what-if identity needs ProviderNoRbac.
set -euo pipefail

ignored="$(az deployment group what-if \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --validation-level "${WHAT_IF_VALIDATION_LEVEL:-Provider}" \
  --no-pretty-print \
  --query "changes[?changeType=='Ignore'].resourceId" \
  --output tsv)"

# grep fails when nothing is left, which is the usual case.
grep -viE '^$|/providers/(Microsoft\.ManagedIdentity/userAssignedIdentities/|Microsoft\.Sql/servers/[^/]+/databases/master$)' \
  <<<"${ignored}" | sort || true
