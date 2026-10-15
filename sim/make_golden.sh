#!/usr/bin/env bash
# Regenerate web/test/golden from the Python simulator with NO_COLOR=1.
# CI fails if the committed transcripts drift from this output.
set -euo pipefail
cd "$(dirname "$0")/.."
out="web/test/golden"
mkdir -p "$out"
codes="$(mktemp)"
trap 'rm -f "$codes"' EXIT

capture_scenario() {
  local name="$1"
  local rc=0
  NO_COLOR=1 python3 sim/harness_sim.py --scenario "$name" < /dev/null > "$out/$name.txt" || rc=$?
  printf '%s %s\n' "$name" "$rc" >> "$codes"
}

capture_interactive() {
  local name="$1"
  shift
  local rc=0
  printf '%s\n' "$@" | NO_COLOR=1 python3 sim/harness_sim.py > "$out/$name.txt" || rc=$?
  printf '%s %s\n' "$name" "$rc" >> "$codes"
}

capture_scenario pass
capture_scenario break-eval
capture_scenario rogue-tool
capture_scenario no-approval
capture_interactive audience \
  run \
  break \
  run \
  fix \
  "threshold task_completion 1.1" \
  run \
  "threshold task_completion 0.75" \
  noapprove \
  run \
  quit
capture_interactive rogue \
  rogue \
  run \
  quit
capture_interactive bad-threshold \
  threshold \
  "threshold task_completion" \
  "threshold task_completion nope" \
  "threshold task_completion 0.9 extra" \
  quit
capture_interactive unknown-command \
  wat \
  help \
  quit
capture_interactive show \
  "task rewrite the guardrail" \
  break \
  rogue \
  noapprove \
  "threshold safety 0.3" \
  show \
  fix \
  norogue \
  approve \
  show \
  quit

LC_ALL=C sort "$codes" > "$out/exit-codes.txt"
