#!/usr/bin/env bash
# Seeds a preview environment with the sample flash cards in preview-seed-data.json (Spanish and English pairs, with tags),
# and the sample decks made from them (which name their cards by their Spanish), through the API so the data goes
# through the same validation as real use. Runs after the smoke tests, which have already waited for the API to be
# ready.
#
# Every deployment starts the preview over: it deletes every deck and flash card of the seed's user first, so
# whatever reviewers changed as that user is gone and the samples are never duplicated. Cards other test users made
# are left alone. A seed that stops partway is redone in full by the next deployment.
# Requires API_URL and API_AUTH_TOKEN (the test sign-in the cards are created for), and runs from the
# repository root.
set -euo pipefail

seed_file=.github/scripts/preview-seed-data.json

api() {
  curl --fail-with-body --silent --show-error --max-time 60 -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${API_AUTH_TOKEN}" "$@"
}

# Only reads are retried: a retried POST or DELETE whose first attempt did go through would fail or duplicate.
# Decks go first, since a sample deck can't be added while one with its name is left.
for resource in decks flashcards; do
  existing="$(api --retry 3 --retry-all-errors "${API_URL}/api/${resource}")"
  deleted=0
  for id in $(jq -r '.[].id' <<<"${existing}"); do
    api -X DELETE "${API_URL}/api/${resource}/${id}" --output /dev/null
    deleted=$((deleted + 1))
  done
  echo "Deleted the preview's ${deleted} ${resource}"
done

# Each new card's id by its Spanish, for the decks.
ids='{}'
count="$(jq '.cards | length' "${seed_file}")"
for i in $(seq 0 $((count - 1))); do
  spanish="$(jq -r ".cards[${i}].spanish" "${seed_file}")"
  id="$(jq -c ".cards[${i}]" "${seed_file}" | api -X POST --data @- "${API_URL}/api/flashcards" | jq -r .id)"
  ids="$(jq -c --arg spanish "${spanish}" --argjson id "${id}" '. + {($spanish): $id}' <<<"${ids}")"
  echo "Added flash card ${id}, \"${spanish}\""
done

# A deck naming a card that isn't in the file sends a null id, which the API refuses, so the seed fails.
deck_count="$(jq '.decks | length' "${seed_file}")"
for i in $(seq 0 $((deck_count - 1))); do
  name="$(jq -r ".decks[${i}].name" "${seed_file}")"
  id="$(jq -c --argjson ids "${ids}" ".decks[${i}] | {name, flashCardIds: [.cards[] | \$ids[.]]}" "${seed_file}" \
    | api -X POST --data @- "${API_URL}/api/decks" | jq -r .id)"
  echo "Added deck ${id}, \"${name}\""
done

echo "Seeded the preview with ${count} flash cards and ${deck_count} decks"
