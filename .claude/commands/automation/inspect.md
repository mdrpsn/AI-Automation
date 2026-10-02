---
description: Read the workflow back and run the static audit (no execution)
argument-hint: "[workflow path, default from state]"
---
Inspect the workflow. Path override: $ARGUMENTS

1. `python3 automation/tools/state.py show` for `workflow_path` and state. Allowed: BUILT, or any state to get a read-only report (then do not change state unless the skill's transition rules apply).
2. Use the **n8n-inspector** skill. Report errors/warnings with node names; label the result STATICALLY VERIFIED or STATIC_ERRORS_FOUND, and always RUNTIME NOT TESTED.
