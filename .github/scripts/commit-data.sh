#!/usr/bin/env bash
# Commit and push the collector's output from a GitHub Actions run.
#
# Two runs can overlap: a delayed cron landing seconds after a manual
# dispatch, for example. Both rewrite the same lines of the same JSON files,
# so rebasing one data commit onto the other always conflicts. Instead, the
# newest run wins: reset to whatever is on origin, put this run's freshly
# generated data back on top, commit and push. A same-day run is an upsert of
# the same day's points, so normally nothing is lost by overwriting the
# earlier one.
#
# "Normally" is not "never": a run that started from an older checkout could
# overwrite points another run pushed meanwhile, and nothing else checks the
# bot's commits (pushes made with GITHUB_TOKEN trigger no workflows). So before
# committing, cmd/dataguard compares this run's output with what is on origin
# and the script refuses to commit anything that would lose a history file, a
# point, or a tracked game. Git history is the first-tier backup of data/; the
# earlier commit simply stands until the next run.
#
# Usage: commit-data.sh <data-dir> <branch>
# Prints changed=true|false to $GITHUB_OUTPUT when that variable is set.
set -euo pipefail

data_dir=${1:-data}
branch=${2:-main}
fresh=$(mktemp -d)
tools=$(mktemp -d)
trap 'rm -rf "$fresh" "$tools"' EXIT

cp -R "$data_dir/." "$fresh/"
go build -o "$tools/dataguard" ./cmd/dataguard

report() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "changed=$1" >> "$GITHUB_OUTPUT"; }

for attempt in 1 2 3; do
  git rebase --abort >/dev/null 2>&1 || true
  git fetch --quiet origin "$branch"
  git reset --quiet --hard "origin/$branch"
  rm -rf "$data_dir"
  mkdir -p "$data_dir"
  cp -R "$fresh/." "$data_dir/"
  if ! "$tools/dataguard" -before HEAD -after-dir "$data_dir"; then
    echo "Refusing to commit: this run's output would lose collected data (see above)." >&2
    report false
    exit 1
  fi
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
