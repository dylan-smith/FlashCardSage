#!/usr/bin/env bash
# Seeds a preview environment with the sample flash cards in preview-seed-data.json (Spanish and English words, with tags),
# and the sample decks made from them (which name their cards by their first Spanish word), through the API so the data goes
# through the same validation as real use. Runs after the smoke tests, which have already waited for the API to be
# ready. A card marked "picture" gets one made by the API's image generator, so previews show pictures and exercise
# it; a preview without a generator, or a picture that can't be made, just leaves the card without one.
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

# Makes a picture of the card's words and puts it on the card. A picture takes the generator tens of seconds.
add_picture() {
  local id="$1" words="$2" picture
  if ! picture="$(api --max-time 120 -X POST --data "${words}" "${API_URL}/api/flashcards/images/generate")"; then
    echo "::notice::No picture for flash card ${id}: the API couldn't make one (see above)"
    return 0
  fi
  # Through stdin: a picture is a couple of hundred kilobytes, more than an argument can be.
  if printf '%s' "${picture}" | api -X PUT --data-binary @- "${API_URL}/api/flashcards/${id}/image" --output /dev/null; then
    echo "Added a picture to flash card ${id}"
  else
    echo "::notice::No picture for flash card ${id}: the API didn't accept it (see above)"
  fi
}

# Each new card's id by its first Spanish word, for the decks.
ids='{}'
count="$(jq '.cards | length' "${seed_file}")"
for i in $(seq 0 $((count - 1))); do
  card="$(jq -c ".cards[${i}]" "${seed_file}")"
  spanish="$(jq -r '.spanish[0]' <<<"${card}")"
  id="$(jq -c 'del(.picture)' <<<"${card}" | api -X POST --data @- "${API_URL}/api/flashcards" | jq -r .id)"
  ids="$(jq -c --arg spanish "${spanish}" --argjson id "${id}" '. + {($spanish): $id}' <<<"${ids}")"
  echo "Added flash card ${id}, \"${spanish}\""
  if [ "$(jq -r '.picture // false' <<<"${card}")" = "true" ]; then
    # The image generator takes one piece of text for each side, as the frontend sends it.
    add_picture "${id}" "$(jq -c '{spanish: (.spanish | join(" / ")), english: (.english | join(" / "))}' <<<"${card}")"
  fi
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
