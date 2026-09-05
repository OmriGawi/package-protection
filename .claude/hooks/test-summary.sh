#!/usr/bin/env bash
# PostToolUse/Bash hook: prints a compact pass/fail line after a Vitest run.
#
# Reads the hook payload on stdin, flattens every string in it (the Bash tool
# response shape is not guaranteed), and reads Vitest's own output:
#
#        RUN  v5.0.0 /Users/…/package-protector/frontend   → which package
#   Test Files  6 passed (6)                               → how many files
#        Tests  52 passed (52)                             → how many tests
#        Tests  31 failed | 41 passed | 8 skipped (80)
#
# The package name and the run's scope both matter: a bare "52/52" cannot be
# told apart from a single-file run, and "6/6" says nothing about which six.
#
# Stays silent for any command that is not a test run, and for a test run whose
# output has no summary line (a crash before the suite reported).

set -uo pipefail

payload=$(cat)

command=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)

# The command itself must be a test invocation. Without this the hook fires on
# anything whose output merely contains a Vitest summary line — cat-ing a saved
# log, grepping one, or piping a fixture through this very script — and reports
# numbers no run produced.
printf '%s' "$command" | grep -qE '(^|[;&|[:space:]])(npx +)?vitest([[:space:]]|$)|(^|[;&|[:space:]])(npm|pnpm|yarn|bun)([[:space:]]+run)?[[:space:]]+test([[:space:]]|$)' || exit 0

# All string values in the payload, one per line — field-name agnostic.
flat=$(printf '%s' "$payload" | jq -r '[.. | strings] | join("\n")' 2>/dev/null) || exit 0

summary=$(printf '%s' "$flat" | grep -E '^[[:space:]]*Tests[[:space:]]+[0-9]' | tail -1)
[ -n "$summary" ] || exit 0

passed=$(printf '%s' "$summary" | grep -oE '[0-9]+ passed' | grep -oE '^[0-9]+')
failed=$(printf '%s' "$summary" | grep -oE '[0-9]+ failed' | grep -oE '^[0-9]+')
skipped=$(printf '%s' "$summary" | grep -oE '[0-9]+ skipped' | grep -oE '^[0-9]+')
total=$(printf '%s' "$summary" | grep -oE '\([0-9]+\)$' | grep -oE '[0-9]+')

passed=${passed:-0}
failed=${failed:-0}
skipped=${skipped:-0}
total=${total:-0}

# Which package: Vitest prints its root directory in the RUN banner. Falls back
# to the tool call's own cwd when that banner is missing (reporter changes).
root=$(printf '%s' "$flat" | grep -oE 'RUN +v[0-9][^ ]* +/.*' | tail -1 | sed -E 's/.* (\/.*)$/\1/')
[ -n "$root" ] || root=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)
package=$(basename "${root:-unknown}")

# Which scope: an explicit test path in the command means one file was run, not
# the package's suite. Report the file rather than a file count.
targets=$(printf '%s' "$command" | grep -oE '[^ ]+\.test\.[cm]?[jt]sx?' | xargs -n1 basename 2>/dev/null | sort -u | paste -sd, -)

if [ -n "$targets" ]; then
  scope="$targets"
else
  files=$(printf '%s' "$flat" | grep -E '^[[:space:]]*Test Files[[:space:]]+[0-9]' | tail -1 | grep -oE '\([0-9]+\)$' | grep -oE '[0-9]+')
  scope="${files:-?} files"
fi

if [ "$failed" -gt 0 ]; then
  line="🔴 ${package} ${passed}/${total} tests — ${failed} failed · ${scope}"
else
  line="🟢 ${package} ${passed}/${total} tests · ${scope}"
fi
[ "$skipped" -gt 0 ] && line="${line} · ${skipped} skipped"

jq -n --arg msg "$line" '{systemMessage: $msg, suppressOutput: true}'
