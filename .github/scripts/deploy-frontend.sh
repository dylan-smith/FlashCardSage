#!/usr/bin/env bash
# Deploys frontend/dist to the storage account's static website (npm run deploy). Requires AZURE_STORAGE_ACCOUNT_NAME.
#
# The hashed files under assets/ go first, with a long cache lifetime, so the index.html uploaded after them never
# points at a file that isn't there yet. Then everything is synced, which also deletes files left from earlier builds
# (sync skips the blobs just uploaded, since they're newer than the local files). index.html, and sw.js (the service
# worker, which keeps the app for offline use), are what browsers check for a new version, so they're marked no-cache
# and given the types browsers expect, which sync can't set. So is manifest.webmanifest, whose name and icons
# browsers read when the app is installed.
set -euo pipefail

cd "$(dirname "$0")/../../frontend"

common=(--account-name "${AZURE_STORAGE_ACCOUNT_NAME}" --auth-mode login --only-show-errors --output none)

az storage blob upload-batch "${common[@]}" \
  --destination '$web' --destination-path assets --source dist/assets \
  --content-cache-control 'public, max-age=31536000, immutable' --overwrite

az storage blob sync "${common[@]}" --container '$web' --source dist --delete-destination true

az storage blob update "${common[@]}" --container-name '$web' --name index.html \
  --content-cache-control 'no-cache' --content-type 'text/html'

az storage blob update "${common[@]}" --container-name '$web' --name sw.js \
  --content-cache-control 'no-cache' --content-type 'text/javascript'

az storage blob update "${common[@]}" --container-name '$web' --name manifest.webmanifest \
  --content-cache-control 'no-cache' --content-type 'application/manifest+json'
