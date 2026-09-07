#!/usr/bin/env bash
# Publish the run's raw listing archive(s) as assets of this month's
# prerelease. The archives are what let a classifier change be replayed over
# the same market instead of wiping history, and at ~400 KB per run they are
# too large to commit twice a day. Release assets cost nothing and stay
# downloadable with `gh release download raw-YYYY-MM`.
#
# Usage: upload-raw.sh <raw-dir>
# Exits non-zero when nothing was uploaded; the workflow step continues on
# error so a hiccup here never blocks the data commit, but the warning shows.
set -euo pipefail

dir=${1:-raw}
shopt -s nullglob
files=("$dir"/raw-*.json.gz)
if [ ${#files[@]} -eq 0 ]; then
  echo "::warning title=No raw archive to upload::The collector wrote nothing under $dir."
  exit 1
fi

month=$(date -u +%Y-%m)
tag="raw-$month"
if ! gh release view "$tag" >/dev/null 2>&1; then
  if ! gh release create "$tag" --prerelease --title "Raw listings $month" \
      --notes "One compressed file per collector run: every listing the run saw, before classification. cmd/replay rebuilds history from these under newer rules; see METHODOLOGY.md."; then
    echo "::warning title=Raw archive upload failed::Could not create release $tag."
    exit 1
  fi
fi
if ! gh release upload "$tag" "${files[@]}" --clobber; then
  echo "::warning title=Raw archive upload failed::Could not upload ${#files[@]} file(s) to release $tag."
  exit 1
fi
echo "Uploaded ${#files[@]} archive(s) to release $tag."
