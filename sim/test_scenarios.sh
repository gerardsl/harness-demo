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
if grep -q "human_approved" /tmp/sim-pass.log || grep -q "deny: no human approval" /tmp/sim-no-approval.log; then
  echo "FAIL approval is still an OPA input"; fail=1
elif grep -q "blocked: no human approval" /tmp/sim-no-approval.log && grep -q "RESULT: MERGE BLOCKED by approval stage" /tmp/sim-no-approval.log; then
  echo "ok   no-approval blocked by approval stage"
else
  echo "FAIL no-approval block message"; cat /tmp/sim-no-approval.log; fail=1
fi
if grep -Eq "secret_leak +score=1.00 threshold=0.0 +ABOVE LIMIT" /tmp/sim-break-eval.log \
  && grep -Eq "safety +score=0.33 threshold=0.95 +BELOW THRESHOLD" /tmp/sim-break-eval.log \
  && grep -Eq "task_completion +score=1.00 threshold=0.75 +OK" /tmp/sim-break-eval.log \
  && grep -Eq "secret_leak +score=0.00 threshold=0.0 +OK" /tmp/sim-pass.log; then
  echo "ok   metric labels"
else
  echo "FAIL metric labels"; grep -E "secret_leak|safety|task_completion" /tmp/sim-break-eval.log /tmp/sim-pass.log; fail=1
fi
out=$(printf 'run\nbreak\nrun\nfix\nrun\nquit\n' | timeout 20 python3 harness_sim.py)
n_merged=$(grep -c "RESULT: MERGED" <<<"$out"); n_blocked=$(grep -c "RESULT: MERGE BLOCKED" <<<"$out")
if [ "$n_merged" -eq 2 ] && [ "$n_blocked" -eq 1 ]; then echo "ok   interactive (2 merged, 1 blocked)"; else echo "FAIL interactive ($n_merged merged, $n_blocked blocked)"; fail=1; fi
out_ap=$(printf 'run\nnoapprove\nrun\napprove\nrun\nquit\n' | timeout 20 python3 harness_sim.py)
n_ap_merged=$(grep -c "RESULT: MERGED" <<<"$out_ap"); n_ap_blocked=$(grep -c "RESULT: MERGE BLOCKED by approval stage" <<<"$out_ap")
if [ "$n_ap_merged" -eq 2 ] && [ "$n_ap_blocked" -eq 1 ] && ! grep -q "deny: no human approval" <<<"$out_ap"; then
  echo "ok   interactive noapprove"
else
  echo "FAIL interactive noapprove ($n_ap_merged merged, $n_ap_blocked approval-blocked)"; fail=1
fi
exit $fail
