---
description: Run the test plan and record truthful results (PASS/FAIL/BLOCKED/NOT_TESTED)
argument-hint: "[test ids to run, default all]"
---
Test the current automation. Scope: $ARGUMENTS

1. `python3 automation/tools/state.py show`. Allowed: INSPECTED (-> TESTING), after a repair INSPECTED (-> RETESTING), or TESTING/RETESTING to resume. Otherwise stop and cite `state.py next`.
2. Use the **automation-tester** skill. No external side effects; no fabricated results; BLOCKED stays BLOCKED.
3. Show `python3 automation/tools/testlog.py summary` and the resulting state. On FAIL, tell the user `/automation:repair` is next.
