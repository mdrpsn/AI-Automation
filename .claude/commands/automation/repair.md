---
description: Diagnose a failure and apply one bounded repair cycle
argument-hint: "[hint about the failure]"
---
Repair the current automation. Hint: $ARGUMENTS

1. `python3 automation/tools/state.py show`. Allowed: FAILED, DIAGNOSED, REPAIRING. Otherwise stop and cite `state.py next`. If BLOCKED, report `blocked.reason` and stop.
2. FAILED -> use the **failure-diagnosis** skill. DIAGNOSED/REPAIRING -> use the **automation-repair** skill, then **n8n-inspector**.
3. One cycle per invocation. Report repair cycles used/left. If the tool moves the state to BLOCKED (HUMAN_INVESTIGATION_REQUIRED), stop and give the diagnoses so far; do not edit further.
4. After a successful repair, point to `/automation:test` (RETESTING).
