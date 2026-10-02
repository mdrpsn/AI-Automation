---
description: Audit the harness and repo: self-tests, all workflow JSONs, state and safety consistency
argument-hint: "[workflow paths, default all */workflow.json]"
---
Audit the harness and workflows. Targets: $ARGUMENTS

1. Re-run the tool check: `python3 automation/tools/capabilities.py --observed-tools "<tools you can actually call>" --no-write` and report levels.
2. `python3 -m unittest discover -s automation/tests -v` — report the real pass/fail counts.
3. `python3 automation/tools/validate_workflow.py <targets or */workflow.json>` — summarize ERRORs and notable WARNs per workflow; label STATICALLY VERIFIED / RUNTIME NOT TESTED.
4. Consistency: state.json parses, state is a legal state, safety flags are at defaults unless APPROVED/ACTIVATED, no workflow with `"active": true`, no secrets flagged by the validator, `tests.json` has no PASS without evidence.
5. Report findings only. Do not fix, commit, or activate anything unless asked.
