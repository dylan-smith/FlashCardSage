#!/usr/bin/env bash
# Deploys frontend/dist to the storage account's static website (npm run deploy). Requires AZURE_STORAGE_ACCOUNT_NAME.
#
# The hashed files under assets/ go first, with a long cache lifetime, so the index.html uploaded after them never
# points at a file that isn't there yet. Then everything is synced, which also deletes files left from earlier builds
# (sync skips the blobs just uploaded, since they're newer than the local files). index.html is what browsers check
# for a new version, so it's marked no-cache and given the type browsers expect, which sync can't set.
set -euo pipefail

cd "$(dirname "$0")/../../frontend"

common=(--account-name "${AZURE_STORAGE_ACCOUNT_NAME}" --auth-mode login --only-show-errors --output none)

az storage blob upload-batch "${common[@]}" \
  --destination '$web' --destination-path assets --source dist/assets \
  --content-cache-control 'public, max-age=31536000, immutable' --overwrite

az storage blob sync "${common[@]}" --container '$web' --source dist --delete-destination true

az storage blob update "${common[@]}" --container-name '$web' --name index.html \
  --content-cache-control 'no-cache' --content-type 'text/html'
