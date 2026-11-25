#!/usr/bin/env bash
# Lets this runner connect to the database when the SQL server's firewall would turn it away. The server only
# allows addresses inside Azure (its AllowAllWindowsAzureIps rule), and GitHub runs some jobs on runners outside
# Azure, which then fail with "Client with IP address '...' is not allowed to access the server" (error 40615).
#   open   checks whether the database accepts a connection from this runner. If the firewall turns it away, adds
#          a rule for the runner's address, taking the server's name and the address from the server's own error
#          (see ConnectionCheck in the Database CLI), then waits until the runner can connect: a new rule can take
#          a few minutes to take effect. A runner inside Azure connects straight away, and nothing is changed.
#          A paused serverless database answers "not currently available" until it has resumed, whoever asks, so
#          any other failure is tried again too, until the time runs out.
#   close  removes the rule, if open added one. Run it even when the steps in between fail.
# The rule is named after the job and the workflow run, so jobs running at the same time leave each other's
# alone. A job that's killed before close runs leaves its rule behind, which lets in that one address.
#
# Requires SQL_RESOURCE_GROUP (the SQL server's), an az login that can change the server's firewall rules and,
# for open, CONNECTION_STRING (the one the later steps use). Runs from the repository root, after the Database
# CLI is published.
set -euo pipefail

database_cli=./backend/database-publish/FlashCardSage.Database
# ConnectionCheck.TurnedAway.
turned_away=3
rule="github-${GITHUB_JOB}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
# Holds the server's name while the rule exists, for close.
rule_server_file="${RUNNER_TEMP}/sql-firewall-server"

case "${1:-}" in
  open)
    deadline=$((SECONDS + 360))
    while true; do
      status=0
      output="$("${database_cli}" --check-connection "${CONNECTION_STRING}" 2>&1)" || status=$?
      if [ "${status}" -eq 0 ]; then
        echo "The database accepts connections from this runner"
        exit 0
      fi
      if [ "${status}" -ne "${turned_away}" ]; then
        echo "Couldn't connect to the database: ${output%%$'\n'*}"
      elif [ ! -f "${rule_server_file}" ]; then
        read -r server address <<<"${output}"
        echo "The SQL server ${server} turned this runner (${address}) away; adding firewall rule ${rule} for it"
        az sql server firewall-rule create \
          --resource-group "${SQL_RESOURCE_GROUP}" \
          --server "${server}" \
          --name "${rule}" \
          --start-ip-address "${address}" \
          --end-ip-address "${address}" \
          --only-show-errors \
          --output none
        echo "${server}" >"${rule_server_file}"
      else
        echo "The firewall rule hasn't taken effect yet"
      fi
      if [ "${SECONDS}" -ge "${deadline}" ]; then
        if [ "${status}" -ne "${turned_away}" ]; then
          echo "${output}"
        fi
        echo "::error::This runner still can't connect to the database"
        exit 1
      fi
      echo "Trying again in 10 seconds"
      sleep 10
    done
    ;;
  close)
    if [ ! -f "${rule_server_file}" ]; then
      echo "No firewall rule was added for this runner"
      exit 0
    fi
    server="$(<"${rule_server_file}")"
    if ! az sql server firewall-rule delete \
      --resource-group "${SQL_RESOURCE_GROUP}" \
      --server "${server}" \
      --name "${rule}" \
      --only-show-errors \
      --output none; then
      echo "::warning::Couldn't remove firewall rule ${rule} from the SQL server ${server}. Remove it by hand."
      exit 1
    fi
    rm -f "${rule_server_file}"
    echo "Removed firewall rule ${rule} from the SQL server ${server}"
    ;;
  *)
    echo "Usage: $0 open|close" >&2
    exit 2
    ;;
esac
