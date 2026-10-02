---
name: automation-discovery
description: First stage of an n8n automation. Understands the requirement, inspects the repo and environment, finds overlapping existing workflows, and lists missing critical information. Use when starting a new automation or when /automation:new runs.
---

# automation-discovery

**Responsibility:** establish facts. No design, no building.

**Inputs:** the user's requirement text; `automation/state.json` (must be `NEW` with an initialized automation).

**Procedure**
1. If state has no automation: `python3 automation/tools/state.py init "<name>"` (creates `automation/work/<slug>/` from templates).
2. Run the TOOL CHECK: `python3 automation/tools/capabilities.py --observed-tools "<exact tool names you can call>"`. Pass only tools you can actually see/call — never infer from config. For deferred tools use ToolSearch first.
3. Inspect: repo layout, `CLAUDE.md`, existing `*/workflow.json` (does one already cover part of this? prefer modify over rebuild), tests, git state. Validate any overlapping workflow with `validate_workflow.py` for a baseline.
4. Fill `automation/work/<slug>/discovery.md`: business problem, trigger, data in, transformations, decisions, where AI is truly needed, external actions, systems affected, success definition, failure expectations.
5. List missing critical information explicitly. Never invent requirements.

**Outputs:** `discovery.md`, `automation/reports/environment.json`.

**Handoff**
- Questions that could materially change the build → ask the user (AskUserQuestion), stay in `NEW`.
- Otherwise `state.py transition DISCOVERY_COMPLETE --note "<summary>"` → `automation-planner`.
- Cannot proceed (e.g. repo inaccessible) → `state.py transition BLOCKED --note "<why>"`.
