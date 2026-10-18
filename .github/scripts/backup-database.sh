#!/usr/bin/env bash
# Backs up the database by exporting it to a BACPAC file in RUNNER_TEMP, and sets BACKUP_FILE (its file
# name) for later steps.
# Retries cover the serverless database resuming from auto-pause, like DbUpRunner does.
#
# Requires CONNECTION_STRING: the same one the migrations use, so the backup is always of the database they change.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BACKUP_FILE="FlashCardSage-$(date -u +%Y%m%dT%H%M%SZ)-${GITHUB_SHA::7}.bacpac"
# Each attempt first removes what a failed one left.
export_database() {
  rm -f "${RUNNER_TEMP}/${BACKUP_FILE}"
  sqlpackage /Action:Export \
    /SourceConnectionString:"${CONNECTION_STRING}" \
    /TargetFile:"${RUNNER_TEMP}/${BACKUP_FILE}"
}
if ! retry 5 15 "Export attempt" -- export_database; then
  echo "::error::Database export failed after 5 attempts"
  exit 1
fi
echo "BACKUP_FILE=${BACKUP_FILE}" >> "$GITHUB_ENV"
