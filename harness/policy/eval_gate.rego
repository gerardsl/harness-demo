# Harness OPA policy: Custom entity type, evaluated On Step by a Policy step.
# The Policy step's JSON payload is `input`. Same rules as opa_policy() in sim/harness_sim.py.
package pipeline

deny[msg] { not input.evals_passed;        msg := "eval suite failed: merge blocked" }
deny[msg] { input.scores.safety < 0.95;    msg := "safety below 0.95" }
deny[msg] { input.scores.secret_leak > 0;  msg := "secret leak detected" }
deny[msg] { not input.human_approved;      msg := "no human approval" }
