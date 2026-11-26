#!/usr/bin/env bash
# Report guard-diff's output (the file given) for a pull request.
#   guard-diff-report.sh summary <file>   Markdown for the run's summary, on stdout.
#   guard-diff-report.sh comment <file>   One comment on the pull request ($REPO, $PR), kept up to date: edited on each
#                                         run, and not posted at all while the branch changes no guard.
set -euo pipefail

MARKER="<!-- marram guard-diff -->"
mode=$1
output=$(cat "$2")

body() {
	printf '%s\n### Guard changes\n\nWhat this pull request changes in the checks that judge it (`marram guard-diff`):\n\n````text\n%s\n````\n' "$MARKER" "$output"
}

case $mode in
summary)
	body
	;;
comment)
	existing=$(gh api "repos/$REPO/issues/$PR/comments" --paginate --jq ".[] | select(.body | startswith(\"$MARKER\")) | .id" | head -n 1)
	if [[ -n $existing ]]; then
		gh api --method PATCH "repos/$REPO/issues/comments/$existing" -f body="$(body)" > /dev/null
	elif [[ $output != "No guard changes"* ]]; then
		gh api --method POST "repos/$REPO/issues/$PR/comments" -f body="$(body)" > /dev/null
	fi
	;;
*)
	echo "Usage: guard-diff-report.sh summary|comment <guard-diff output>" >&2
	exit 1
	;;
esac
