---
name: failure-diagnosis
description: Root-cause analysis of a failed test or inspection, classified A-G, without changing anything. Use when state is FAILED or /automation:repair runs.
---

# failure-diagnosis

**Responsibility:** explain a failure precisely. Read-only.

**Inputs:** state `FAILED`, failing records in `tests.json`, validator output, workflow file, `diagnosis.md`.

**Procedure** (answer all in `diagnosis.md`):
1. What failed? 2. Where (node/test/tool)? 3. Expected? 4. Actual (quote evidence)? 5. Why (root cause, not symptom)? 6. Class: **A** Configuration · **B** Workflow logic · **C** Data · **D** External dependency · **E** AI behavior · **F** Infrastructure · **G** Test problem. 7. Owner: workflow / input / credential / environment / external service / test. 8. Smallest appropriate repair. 9. Regression risk.

Check class **G** first: is the test itself wrong? Check **A/D/F** next: a missing credential or unreachable service is a BLOCKED test or a human action, not a workflow edit.

Then: `state.py transition DIAGNOSED --failure-class <A-G> --root-cause "<one sentence>"`.

**Handoff**
- Class A/D/F needing a human (credentials, environment) → `transition BLOCKED --note …`.
- Class G → fix the test via `automation-repair` (test side), do not touch the workflow.
- Otherwise → `automation-repair`.
- Repeated identical root cause across cycles → say so; it signals a wrong repair, not bad luck.
