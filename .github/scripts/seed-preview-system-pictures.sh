#!/usr/bin/env bash
# Gives a few of the built-in decks' cards pictures in a preview (the Spanish words in preview-seed-data.json's
# systemCardPictures), so reviewers can see pictures on the Import cards page and that importing a deck copies them.
# Nothing in the app can give a built-in card a picture, so it's done around the API: the API's image generator makes
# the picture, it's uploaded to the preview's card-images container as BlobImageStore would store it, and this writes
# the SQL that puts it on the card to SQL_FILE, which the next workflow step runs. It sets count in GITHUB_OUTPUT to
# how many cards that is.
#
# A card that already has a picture, from an earlier deployment, keeps it. A preview without a generator, or a
# picture that can't be made or uploaded, just leaves the card without one, like seed-preview.sh does.
# Requires API_URL, API_AUTH_TOKEN, AZURE_STORAGE_ACCOUNT_NAME and SQL_FILE, and runs from the repository root.
set -euo pipefail

seed_file=.github/scripts/preview-seed-data.json
container=card-images

api() {
  curl --fail-with-body --silent --show-error --max-time 60 -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${API_AUTH_TOKEN}" "$@"
}

# The API adds the built-in decks when it starts, which the smoke tests have already waited for.
cards="$(api --retry 3 --retry-all-errors "${API_URL}/api/system-decks" | jq -c '[.[].cards[]]')"

# Ends with a slash, as the API's own URLs are made from it.
blob_endpoint="$(az storage account show --name "${AZURE_STORAGE_ACCOUNT_NAME}" \
  --query primaryEndpoints.blob --only-show-errors --output tsv)"

: >"${SQL_FILE}"
count=0
while IFS= read -r spanish; do
  card="$(jq -c --arg spanish "${spanish}" 'map(select(any(.spanish[]; . == $spanish))) | first' <<<"${cards}")"
  if [ "${card}" = "null" ]; then
    echo "::notice::No built-in card has the Spanish \"${spanish}\", so it gets no picture"
    continue
  fi
  id="$(jq -r .id <<<"${card}")"
  if [ "$(jq -r '.imageUrl // empty' <<<"${card}")" != "" ]; then
    echo "Built-in card ${id}, \"${spanish}\", already has a picture"
    continue
  fi

  # The image generator takes one piece of text for each side, as the frontend sends it. A picture takes it tens of
  # seconds, and it refuses more than a few in a row (the sample cards' pictures were just made), which the API
  # answers with a 502, so a failed one is tried again a minute later.
  words="$(jq -c '{spanish: (.spanish | join(" / ")), english: (.english | join(" / "))}' <<<"${card}")"
  picture=""
  for attempt in 1 2 3; do
    if picture="$(api --max-time 120 -X POST --data "${words}" "${API_URL}/api/flashcards/images/generate")"; then
      break
    fi
    picture=""
    if [ "${attempt}" -lt 3 ]; then
      echo "Making a picture for built-in card ${id} failed; trying again in 60 seconds"
      sleep 60
    fi
  done
  if [ -z "${picture}" ]; then
    echo "::notice::No picture for built-in card ${id}: the API couldn't make one (see above)"
    continue
  fi

  # Named and stored as BlobImageStore does (see CardImage.NewName), so the API treats it as one of its own.
  content_type="$(jq -r .contentType <<<"${picture}")"
  case "${content_type}" in
    image/jpeg) extension=jpg ;;
    image/png) extension=png ;;
    image/webp) extension=webp ;;
    *)
      echo "::notice::No picture for built-in card ${id}: the generator made a ${content_type}"
      continue
      ;;
  esac
  name="$(tr -d '-' </proc/sys/kernel/random/uuid).${extension}"
  file="$(mktemp)"
  jq -r .data <<<"${picture}" | base64 --decode >"${file}"
  if ! az storage blob upload --account-name "${AZURE_STORAGE_ACCOUNT_NAME}" --auth-mode login \
    --container-name "${container}" --name "${name}" --file "${file}" \
    --content-type "${content_type}" --content-cache-control 'public, max-age=31536000, immutable' \
    --only-show-errors --output none; then
    echo "::notice::No picture for built-in card ${id}: it couldn't be uploaded (see above)"
    rm -f "${file}"
    continue
  fi
  rm -f "${file}"
  url="${blob_endpoint}${container}/${name}"

  # Only the system user's card, and only while it has no picture.
  cat >>"${SQL_FILE}" <<SQL
UPDATE [dbo].[FlashCards] SET [ImageUrl] = N'${url}'
WHERE [Id] = ${id} AND [ImageUrl] IS NULL
    AND [UserId] = (SELECT [Id] FROM [dbo].[Users] WHERE [Subject] = N'system');
SQL
  count=$((count + 1))
  echo "Made a picture for built-in card ${id}, \"${spanish}\""
done < <(jq -r '.systemCardPictures[]' "${seed_file}")

echo "count=${count}" >>"${GITHUB_OUTPUT}"
echo "Made pictures for ${count} built-in cards"
