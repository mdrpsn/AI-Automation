---
description: Show the persisted state, repair budget, safety gates and the next step
---
Report current status from files only (not from memory):

1. `python3 automation/tools/state.py show` and `state.py next`.
2. If `artifact_dir` exists: `python3 automation/tools/testlog.py summary`; note the workflow path and whether it exists.
3. `automation/reports/environment.json` (capability level and generated_at; say if missing or stale).
4. Present: automation, state, capability level, repair cycles used/max, safety flags (workflow_active, external_side_effects_enabled, credentials_modified, production_activation_authorized), tests counts, blocked reason if any, and the next command. Keep it short. Read-only: change nothing.
