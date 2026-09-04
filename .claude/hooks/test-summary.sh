#!/usr/bin/env bash
# PostToolUse/Bash hook: prints a compact pass/fail line after a Vitest run.
#
# Reads the hook payload on stdin, flattens every string in it (the Bash tool
# response shape is not guaranteed), and looks for Vitest's own summary line:
#
#       Tests  80 passed (80)
#       Tests  31 failed | 41 passed | 8 skipped (80)
#
# Stays silent for any command that is not a test run, and for a test run whose
# output has no summary line (a crash before the suite reported).

set -uo pipefail

payload=$(cat)

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

if [ "$failed" -gt 0 ]; then
  line="🔴 tests ${passed}/${total} — ${failed} failed"
else
  line="🟢 tests ${passed}/${total}"
fi
[ "$skipped" -gt 0 ] && line="${line}, ${skipped} skipped"

jq -n --arg msg "$line" '{systemMessage: $msg, suppressOutput: true}'
