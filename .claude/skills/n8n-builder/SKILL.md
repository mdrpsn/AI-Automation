---
name: n8n-builder
description: Builds or modifies the n8n workflow from an approved design, using the highest available capability level, and reads it back. Use after DESIGN_READY or when /automation:build runs.
---

# n8n-builder

**Responsibility:** produce the workflow artifact exactly as designed, inactive, with no secrets.

**Inputs:** `design.md`, `scope.md`, state `DESIGN_READY`, fresh `environment.json`.

**Procedure**
1. TOOL CHECK: re-run `capabilities.py` if the report is missing/stale. `state.py transition BUILDING` is refused without it.
2. Pick the path from `capability_level`:
   - **3** n8n MCP tools (use only tools you actually observed; check their schema first) — API for unsupported operations.
   - **2** live n8n API: author JSON, import **inactive**, read it back via API.
   - **0/1** author `workflow_path` (default `<slug>/workflow.json`) as an n8n JSON export. Say plainly: *nothing was imported into n8n*.
3. Modifying an existing workflow: inspect first, change the minimum, keep unrelated nodes/credentials, note regression risks.
4. Conventions: `"active": false`; unique, descriptive node names; `typeVersion` and `position` on every node; credentials referenced by `{id,name}` placeholders only — never keys; AI output goes through a validation node (Code/IF) before any side-effect node; risky actions behind a human-approval step or left as drafts; explicit error path/`onError` for important nodes; bounded retries.
5. Read it back (re-open the file, or API fetch) and compare to the design: node count/types/names, connections, branches, expressions, credentials, inactive state.
6. `state.py transition BUILT --note "<what was built; read-back result>"`.

**Never:** activate, create credentials, send anything, call mutating production APIs.

**Outputs:** `<slug>/workflow.json` (+ `<slug>/README.md` per repo convention, finalized later).

**Handoff:** `BUILT` → `n8n-inspector`. Can't build (missing info/tools) → `BLOCKED` with reason.
