---
description: Start a new n8n automation: initialize state, run the tool check and discovery
argument-hint: "<requirement or automation name>"
---
Start a new automation from: $ARGUMENTS

1. Read `automation/state.json` (`python3 automation/tools/state.py show`). If an unfinished automation exists, report it and ask whether to continue it (`/automation:status`) or restart (`init --force`). Stop until answered.
2. If `$ARGUMENTS` is empty, ask the user for the requirement; do not invent one.
3. Use the **automation-discovery** skill. It initializes state, runs the capability check, inspects the repo/existing workflows, and fills `discovery.md`.
4. End by running `python3 automation/tools/state.py next` and telling the user the next command. Report using VERIFIED / ASSUMED / NOT TESTED.
