# AI-Automation

Portfolio of small-business automation builds (one folder per build, each with a README; n8n builds ship a
`workflow.json` export). This repo also contains the **n8n Automation Harness** (`automation/`, `.claude/`),
the governing operating model for building n8n automations. Details: `automation/README.md`.

## Source of truth
- **Project state is `automation/state.json`, never conversation memory.** Read it first
  (`python3 automation/tools/state.py show|next`). Change it only via `state.py` — it enforces the gates.
- Per-automation artifacts live in `automation/work/<slug>/` (discovery, scope, design, test plan, `tests.json`,
  diagnosis log, readiness, documentation). Deliverables follow repo convention: `<slug>/workflow.json` + `<slug>/README.md`.
- Environment facts come from `automation/reports/environment.json` (`capabilities.py`), not from assumptions.

## Operating loop
DISCOVER → CLARIFY → SCOPE FREEZE → DESIGN → TOOL CHECK → BUILD → READ BACK → STATIC INSPECT → TEST →
(DIAGNOSE → REPAIR → INSPECT → RETEST)* → VERIFY → DOCUMENT → HUMAN APPROVAL → ACTIVATE.
Entry points are `/automation:*` commands; procedures are in `.claude/skills/`. Mark skipped stages `N/A — reason`.
Max 3 repair cycles (`max_repair_iterations`), then BLOCKED for a human. No random edit-until-green.

## Hard rules (safety > correctness > requirements > testability > reliability > simplicity > speed)
1. Workflows stay **inactive**. Never activate, and never record APPROVED/ACTIVATED, without an explicit human instruction in this conversation.
2. No external side effects from tests: never send Gmail/SMS, write production sheets/CRMs, or call mutating APIs. Use stubs or stop at the boundary and mark the test BLOCKED.
3. Never create, edit, copy, print, or invent credentials or secrets. Reference credentials by type/name only. If one is needed, stop and say what must be configured.
4. Never fake capability: no pretend n8n MCP, no fabricated executions, no invented test results. Only claim what a tool run showed.
5. Label every claim **VERIFIED** (observed this session), **ASSUMED**, or **NOT TESTED**. Static checks are `STATICALLY VERIFIED`; anything not run in a live n8n is `RUNTIME NOT TESTED`. BLOCKED/NOT_TESTED tests are never PASS.
6. Do not expand scope. Extra ideas go under FUTURE IMPROVEMENTS. Inspect existing workflows before building (modify > rebuild); smallest change on existing ones.
7. AI output is never authoritative: schema validation → business-rule validation → action. No unvalidated LLM output may trigger a high-impact action. Prefer deterministic logic.
8. Consequential actions follow prepare → validate → human approval → execute.
9. Don't commit/push/open PRs unless asked.

## Capability levels (from `capabilities.py`)
0 no runtime → spec, JSON authoring, static validation · 1 workflow artifact → +code-node tests · 2 live n8n API → import/execute/inspect · 3 n8n MCP → MCP first, API fallback.
Level ≥2 means runtime tests are *possible*, not passed.

## Tools (stdlib Python 3, run from repo root)
`state.py` · `capabilities.py --observed-tools "<names you can actually call>"` · `validate_workflow.py <file>` · `testlog.py add|summary`.
Self-test: `python3 -m unittest discover -s automation/tests -v`.

## Final reports
Use `automation/templates/final-report.md`; evidence, not "done".
