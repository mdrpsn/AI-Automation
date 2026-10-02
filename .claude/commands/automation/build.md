---
description: Build or modify the n8n workflow from the approved design (inactive, no secrets)
argument-hint: "[notes]"
---
Build the current automation. Notes: $ARGUMENTS

1. `python3 automation/tools/state.py show`. Allowed: DESIGN_READY (or BUILDING to resume). Otherwise stop and cite `state.py next`.
2. TOOL CHECK: run `python3 automation/tools/capabilities.py --observed-tools "<tools you can actually call>"` and state the capability level. If it is below 2, say plainly that nothing will be imported or executed in n8n.
3. Use the **n8n-builder** skill, then immediately the **n8n-inspector** skill (read back + static audit) on the result.
4. The workflow stays inactive. Report: files changed, node count, read-back result, STATICALLY VERIFIED vs RUNTIME NOT TESTED.
