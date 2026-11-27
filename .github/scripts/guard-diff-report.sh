#!/usr/bin/env bash
# Report guard-diff's output (the file given) for a pull request.
#   guard-diff-report.sh summary <file>   Markdown for the run's summary, on stdout.
#   guard-diff-report.sh comment <file>   One comment on the pull request ($REPO, $PR), kept up to date: edited on each
#                                         run, and not posted at all while the branch changes no guard.
set -euo pipefail

MARKER="<!-- marram guard-diff -->"
mode=$1
# The output comes from the pull request's code, so it's text: cut to fit a comment, and fenced with more backticks than
# any run of them in it, so it can't end the block and post markdown (or mentions) of its own.
output=$(head -c 60000 "$2")
longest=$({ grep -o '`\+' <<< "$output" || true; } | awk '{ if (length > n) n = length } END { print n + 0 }')
fence=$(printf '%*s' $((longest < 3 ? 4 : longest + 1)) '' | tr ' ' '`')

body() {
	printf '%s\n### Guard changes\n\nWhat this pull request changes in the checks that judge it (`marram guard-diff`):\n\n%stext\n%s\n%s\n' "$MARKER" "$fence" "$output" "$fence"
}

case $mode in
summary)
	body
	;;
comment)
	existing=$(gh api "repos/$REPO/issues/$PR/comments" --paginate --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$MARKER\"))) | .id" | head -n 1)
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
