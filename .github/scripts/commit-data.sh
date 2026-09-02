#!/usr/bin/env bash
# Commit and push the collector's output from a GitHub Actions run.
#
# Two runs can overlap: a delayed cron landing seconds after a manual
# dispatch, for example. Both rewrite the same lines of the same JSON files,
# so rebasing one data commit onto the other always conflicts. Instead, the
# newest run wins: reset to whatever is on origin, put this run's freshly
# generated data back on top, commit and push. A same-day run is an upsert of
# the same day's points, so nothing is lost by overwriting the earlier one.
#
# Usage: commit-data.sh <data-dir> <branch>
# Prints changed=true|false to $GITHUB_OUTPUT when that variable is set.
set -euo pipefail

data_dir=${1:-data}
branch=${2:-main}
fresh=$(mktemp -d)
trap 'rm -rf "$fresh"' EXIT

cp -R "$data_dir/." "$fresh/"

report() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "changed=$1" >> "$GITHUB_OUTPUT"; }

for attempt in 1 2 3; do
  git rebase --abort >/dev/null 2>&1 || true
  git fetch --quiet origin "$branch"
  git reset --quiet --hard "origin/$branch"
  rm -rf "$data_dir"
  mkdir -p "$data_dir"
  cp -R "$fresh/." "$data_dir/"
  git add "$data_dir"
  if git diff --cached --quiet; then
    echo "No data changes."
    report false
    exit 0
  fi
  git commit --quiet -m "data: refresh $(date -u +%F)"
  if git push --quiet origin "HEAD:$branch"; then
    report true
    exit 0
  fi
  echo "Push attempt $attempt failed; retrying."
  sleep 5
done

echo "Could not push data commit." >&2
exit 1
