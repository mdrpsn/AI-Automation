---
description: Freeze scope, design the workflow and write the test plan
argument-hint: "[feedback on scope or design]"
---
Plan the current automation. Extra input: $ARGUMENTS

1. `python3 automation/tools/state.py show`. Allowed states: DISCOVERY_COMPLETE, PLAN_READY, SCOPE_FROZEN (resume). Otherwise say what `state.py next` recommends and stop.
2. Use the **automation-planner** skill. Scope freeze requires the user's explicit approval — present the scope and wait; never freeze on your own.
3. Finish with the state and the next command.
