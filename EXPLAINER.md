# How it works under the hood

**What Harness is here.** This is Harness.io, the AI software delivery platform. Two of its features map onto the demo:
- Autonomous Worker Agents run as pipeline steps: https://www.harness.io/blog/introducing-autonomous-worker-agents and https://www.harness.io/blog/identity-and-permissions-for-ai-worker-agents-in-harness
- AI Evals runs as a native gate in the pipeline: https://www.harness.io/products/ai-evals and https://www.harness.io/blog/introducing-ai-evals
- The OPA Policy step is documented at https://developer.harness.io/docs/platform/governance/policy-as-code/add-a-governance-policy-step-to-a-pipeline/

## 1. Orchestration: an agent is just a step
A pipeline is a DAG of stages and steps. A Worker Agent is one more kind of step, so it inherits everything that already governs steps:
- **RBAC** decides who can trigger the agent.
- **OPA** checks the agent's *definition* when it is saved or the pipeline is triggered: allowed models, connectors, turn limits, and whether the agent is from an approved source (Managed, Certified or Community).
- **The MCP gateway** checks every *tool call* as it happens. The tools actually allowed are `connector.allowedTools ∩ agent.allowedTools`. The platform mints a short-lived scoped token for the run and revokes it when the run ends.
- **Approvals and the audit trail** work exactly as they do for a deploy.

In the simulator, `run_agents()` is the loop and the set intersection is the gateway. The `rogue-tool` scenario shows the per-call check.

## 2. The eval gate
An **eval suite** = dataset + metrics (faithfulness, safety, task completion, prompt injection…) + thresholds + a pass strategy (blocking or advisory). It runs as a step, and a regression below threshold fails the pipeline like a failed unit test.

You can then pass the scores to a **Policy step** as a JSON payload. OPA evaluates them against Rego `deny` rules, and any deny stops the run. That separates *measuring* (evals) from *deciding* (policy owned by security). In the simulator, `run_evals()` scores 5 cases and `opa_policy()` mirrors `eval_gate.rego`.

## 3. Why it matters for agent security
The coder agent's own report ("tests green") is not trusted. The merge decision rests on independent evals, policy-as-code and a human. This is defence in depth:
1. The definition is checked at save time (OPA).
2. Every call is checked as it happens (gateway).
3. The output is checked before merge (evals + policy).
4. A human approves at the end.

## Simulator vs real product
The simulator is deterministic and offline, and it models the behaviour; it does not call the Harness API. Running it for real needs a Harness account with Worker Agents and AI Evals enabled, plus the feature flag `PIPE_IS_PRE_STEP_OPA_POLICY_EVALUATION_ENABLED` for the Policy step.
