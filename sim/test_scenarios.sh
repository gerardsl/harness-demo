#!/usr/bin/env bash
# Runs the pass path and every blocked path; fails if any exit code is unexpected.
set -u
cd "$(dirname "$0")"
fail=0
check() { timeout 20 python3 harness_sim.py --scenario "$1" < /dev/null > "/tmp/sim-$1.log" 2>&1; rc=$?
  if [ "$rc" -eq "$2" ]; then echo "ok   $1 (exit $rc)"; else echo "FAIL $1 (exit $rc, want $2)"; cat "/tmp/sim-$1.log"; fail=1; fi; }
check pass 0
check break-eval 1
check rogue-tool 1
check no-approval 1
out=$(printf 'run\nbreak\nrun\nfix\nrun\nquit\n' | timeout 20 python3 harness_sim.py)
n_merged=$(grep -c "RESULT: MERGED" <<<"$out"); n_blocked=$(grep -c "RESULT: MERGE BLOCKED" <<<"$out")
if [ "$n_merged" -eq 2 ] && [ "$n_blocked" -eq 1 ]; then echo "ok   interactive (2 merged, 1 blocked)"; else echo "FAIL interactive ($n_merged merged, $n_blocked blocked)"; fail=1; fi
exit $fail
