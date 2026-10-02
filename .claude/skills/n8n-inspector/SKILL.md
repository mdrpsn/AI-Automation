---
name: n8n-inspector
description: Static audit of a built n8n workflow (structure, connections, expressions, credentials, secrets, activation state, dead branches) plus a design-conformance review. Use after BUILT, after any repair, or when /automation:inspect runs.
---

# n8n-inspector

**Responsibility:** find defects without executing anything. Static only.

**Inputs:** workflow file (`state.workflow_path`), `design.md`.

**Procedure**
1. Run `python3 automation/tools/validate_workflow.py <workflow> [--json]`. Treat every ERROR as a defect, every WARN as a question to answer or accept in writing.
2. Manually review what the tool cannot: branch routing vs design, inverted conditions, field names consistent across nodes, defaults, idempotency/dedup logic, retry/timeout settings, AI step contracts (is the output validated before use?), side-effect nodes behind the right gate.
3. Compare the workflow to `design.md`; list deviations.
4. Record a static test result: `testlog.py add --test-id S1-static --scope STATIC --status PASS|FAIL --evidence "<validator verdict + counts>" --actual ...`.
5. Advance: `state.py transition INSPECTED` (refused if validator errors exist — then `transition FAILED --note ...`).

**Report wording:** `STATICALLY VERIFIED` (tool output) vs `RUNTIME NOT TESTED`. Never imply static pass = works.

**Outputs:** validator report (optionally saved with `--out automation/work/<slug>/static-report.json`), S-tests in `tests.json`.

**Handoff:** `INSPECTED` → `automation-tester` (or `RETESTING` after a repair). Errors → `FAILED` → `failure-diagnosis`.
