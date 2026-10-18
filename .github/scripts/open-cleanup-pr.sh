#!/usr/bin/env bash
# Opens the PR that a nightly check asks for once the thing it waits for has happened. The PR makes the check's
# change and deletes its workflow and scripts, which are no longer needed (this one too, once no other workflow
# runs it). Does nothing if the PR is already open.
# Usage: open-cleanup-pr.sh <check>, where <check> is one of:
#   pkcs-pin           Removes the System.Security.Cryptography.Pkcs pin, once the Pkcs pin check workflow finds the
#                      backend builds cleanly without it. The PR has the project edits pkcs-pin-try.sh made.
#   typescript-compat  Allows Dependabot TypeScript major updates, once the TypeScript/ESLint compatibility
#                      workflow finds the latest TypeScript works with typescript-eslint, by removing the Dependabot
#                      ignore rule. Requires LATEST.
# Requires GH_TOKEN (TS_COMPAT_PR_TOKEN, which can push workflow changes), BRANCH and GITHUB_REPOSITORY, and runs
# from the repository root.
set -euo pipefail

case "${1:-}" in
  pkcs-pin)
    found="The backend builds without the System.Security.Cryptography.Pkcs pin"
    workflow=pkcs-pin-check.yml
    title="Remove the System.Security.Cryptography.Pkcs pin"
    reason="SqlClient no longer brings in a vulnerable version, so the backend builds without warnings without it."
    body="The nightly Pkcs pin check found that, without its direct reference to \`System.Security.Cryptography.Pkcs\`, the backend now builds without warnings and has no vulnerable packages, so the transitive version SqlClient brings in no longer has known vulnerabilities.

This PR:
- removes the \`System.Security.Cryptography.Pkcs\` package reference from the backend projects
- deletes the nightly \`pkcs-pin-check\` workflow and its scripts, which are no longer needed"
    ;;
  typescript-compat)
    found="typescript@$LATEST works with typescript-eslint"
    workflow=typescript-eslint-compat.yml
    title="Allow dependabot TypeScript major updates"
    reason="typescript@$LATEST now works with the latest typescript-eslint."
    body="The nightly TypeScript/ESLint compatibility check found that \`typescript@$LATEST\` now installs and lints cleanly with the latest \`typescript-eslint\`.

This PR:
- removes the dependabot ignore rule for TypeScript major updates, so dependabot will open the upgrade PR
- deletes the nightly \`typescript-eslint-compat\` workflow and its scripts, which are no longer needed"
    ;;
  *)
    echo "Usage: $0 pkcs-pin|typescript-compat" >&2
    exit 2
    ;;
esac

if [ -z "${GH_TOKEN:-}" ]; then
  echo "::error::${found}, but the TS_COMPAT_PR_TOKEN secret isn't set so the PR can't be created."
  exit 1
fi

if [ "$(gh pr list --head "$BRANCH" --state open --json number --jq length)" != "0" ]; then
  echo "PR already open, nothing to do."
  exit 0
fi

if [ "$1" = typescript-compat ]; then
  git checkout -- frontend
  sed -i '/# BEGIN typescript-major-ignore/,/# END typescript-major-ignore/d' .github/dependabot.yml
fi
git rm -q ".github/workflows/${workflow}" ".github/scripts/$1-"*.sh
if ! grep -rq open-cleanup-pr.sh .github/workflows; then
  git rm -q .github/scripts/open-cleanup-pr.sh
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -b "$BRANCH"
git commit -am "${title}" -m "${reason}"
git push --force "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$BRANCH"

gh pr create --base main --head "$BRANCH" --title "${title}" --body "${body}"
