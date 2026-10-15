# Runbook: Harness agents + eval gate (30 min)

Setup (before you start): `git clone https://github.com/gerardsl/harness-demo && cd harness-demo && git checkout nightly`, then Python 3.9+. No account, network or secrets needed. Open `slides.html` in a browser (arrow keys move between slides). Use a terminal font of at least 18 pt.

| Time | Show | Command | Say |
|---|---|---|---|
| 0–3 | Slide 1 | — | "Harness treats an AI agent as just another pipeline step, so RBAC, OPA, approvals and audit all apply to it." |
| 3–5 | Slide 2 | — | "Nothing merges unless the eval suite scores it above threshold, OPA allows it and a human approves." |
| 5–9 | Happy path | `python3 sim/harness_sim.py --scenario pass` | Walk through steps [1]–[6]: four agents, every tool ALLOWED, 5/5 evals, an empty OPA deny list, approval granted, MERGED. |
| 9–13 | Real config | `cat harness/pipeline.yaml harness/policy/eval_gate.rego` | Policy step = Custom entity type with a JSON payload of eval outputs only. Rego `deny` rules are the security gate. Approval is the next stage, not a policy input: the placeholder group `account.ai_merge_approvers` approves, and `disallowPipelineExecutor: true` means whoever triggered the run cannot approve it. |
| 13–17 | Break an eval | `python3 sim/harness_sim.py --scenario break-eval; echo exit=$?` | The coder ships a weaker guardrail and still says "tests green". The evals catch it: safety 0.33 BELOW THRESHOLD, secret_leak 1.00 ABOVE LIMIT, MERGE BLOCKED, exit 1. |
| 17–20 | Rogue tool | `python3 sim/harness_sim.py --scenario rogue-tool` | The coder tries `delete_repo`. The gateway blocks it before evals even run: OPA checks the agent definition, the gateway checks each call. |
| 20–27 | Audience drives | `python3 sim/harness_sim.py` then `run`, `break`, `run`, `fix`, `threshold task_completion 1.1`, `run`, `threshold task_completion 0.75`, `noapprove`, `run`, `quit` | Let the room pick what to break. `task_completion` 1.1 fails the eval gate (BELOW THRESHOLD) and OPA blocks. Restore 0.75 before `noapprove`: OPA allows, and the approval stage blocks the merge. |
| 27–30 | Q&A | `bash sim/test_scenarios.sh` | "This exact check runs in CI on every PR: the gate gates itself." |

Audience notes
- Missing approval is blocked by the HarnessApproval stage, after OPA has allowed the change. It is not an OPA deny.
- The Rego policy hard-codes a 0.95 safety bar. After `break`, `threshold safety 0.3` can mark the safety metric OK, and OPA still denies `safety below 0.95`. Lowering the eval threshold does not get past the security policy.
- Approvers are the placeholder group `account.ai_merge_approvers`. `disallowPipelineExecutor: true` means whoever triggered the run cannot approve it.

Fallbacks
- No colours or an odd terminal: `NO_COLOR=1 python3 ...`.
- Interactive mode won't take input: `printf 'run\nbreak\nrun\nquit\n' | python3 sim/harness_sim.py`.
- No Python on the laptop: show the green CI run on the PR page.
- If someone asks "is this real Harness?": the simulator models the documented behaviour. In `pipeline.yaml`, the Policy and Approval steps follow the docs; the Agent and AIEvals step types are marked ILLUSTRATIVE.
