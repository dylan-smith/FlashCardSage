# shellcheck shell=bash
# Helpers shared by the scripts in this folder. Source it with
#   source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# so it's found wherever the script runs from.

# Runs a command until it succeeds, at most <attempts> times, saying "<message> <n> failed; retrying in <delay>
# seconds" and waiting that long after each failed attempt but the last. Returns 1 when every attempt failed, so
# the caller reports it. The command runs in the current shell, so a function it calls can still exit the script.
# Usage: retry <attempts> <delay> <message> -- <command> [args...]
retry() {
  local attempts="$1" delay="$2" message="$3" attempt
  if [ "${4:-}" != "--" ]; then
    echo "Usage: retry <attempts> <delay> <message> -- <command> [args...]" >&2
    return 2
  fi
  shift 4
  for ((attempt = 1; ; attempt++)); do
    if "$@"; then
      return 0
    fi
    if [ "${attempt}" -ge "${attempts}" ]; then
      return 1
    fi
    echo "${message} ${attempt} failed; retrying in ${delay} seconds"
    sleep "${delay}"
  done
}

# Lists the resources in the preview resource group (PREVIEW_RESOURCE_GROUP) with a JMESPath query, passing any
# further arguments (such as --output) to az. az won't combine --tag with --resource-group, so a pr-number tag is
# filtered in the query.
# Usage: preview_resources <query> [az args...]
preview_resources() {
  az resource list \
    --resource-group "${PREVIEW_RESOURCE_GROUP}" \
    --query "$1" \
    "${@:2}"
}
