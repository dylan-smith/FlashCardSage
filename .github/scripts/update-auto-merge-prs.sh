#!/usr/bin/env bash
# Merges main into every open PR into main that has auto-merge enabled and is behind it, so the PR can merge once
# its checks pass again. A PR that conflicts with main can't be updated this way, so it's left for its author to
# merge by hand. Dependabot PRs are skipped: a merge commit on their branch stops Dependabot from rebasing them, and
# rebase-next-dependabot-pr.sh already brings them up to date one at a time.
# Requires GH_TOKEN (a user's token, so the push runs CI on the PR: pushes made with GITHUB_TOKEN don't) and GH_REPO.
set -euo pipefail

# mergeStateStatus isn't used to find PRs that are behind: GitHub works it out lazily, so just after a push to
# main it's often UNKNOWN, and it reports BLOCKED rather than BEHIND while a PR's checks are failing.
prs=$(gh pr list --state open --base main --limit 100 \
  --json number,headRefOid,autoMergeRequest,author \
  --jq '.[] | select(.autoMergeRequest != null and .author.login != "app/dependabot")
        | "\(.number) \(.headRefOid)"')

if [ -z "$prs" ]; then
  echo "No PRs into main have auto-merge enabled"
  exit 0
fi

while read -r pr head; do
  # ahead_by is the number of commits on main that the PR's branch doesn't have yet
  behind=$(gh api "repos/$GH_REPO/compare/$head...main" --jq .ahead_by)
  if [ "$behind" -eq 0 ]; then
    echo "PR #$pr is up to date with main"
    continue
  fi

  echo "Merging main into PR #$pr ($behind commits behind)"
  # A conflict, or a fork that doesn't allow maintainer edits, shouldn't stop the other PRs from updating
  if ! gh pr update-branch "$pr"; then
    echo "::warning::Couldn't merge main into PR #$pr, probably because they conflict"
  fi
done <<<"$prs"
