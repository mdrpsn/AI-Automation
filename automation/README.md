# n8n Automation Harness

Smallest working harness for `plan → build → inspect → test → repair → verify` on n8n automations,
with safety gates enforced in code. No subagents, no n8n dependency, stdlib Python 3 only.

## Layout
| Path | Role |
|---|---|
| `CLAUDE.md` | Global rules (safety, honesty vocabulary, source of truth) |
| `.claude/skills/*/SKILL.md` | 8 specialist procedures: discovery, planner, n8n-builder, n8n-inspector, automation-tester, failure-diagnosis, automation-repair, production-readiness |
| `.claude/commands/automation/*.md` | Operator entry points: `/automation:` new, plan, build, inspect, test, repair, verify, status, audit |
| `.claude/settings.json` | Pre-allows harness tools; **asks** before Gmail send/reply/forward, Drive share, `npx n8n`, `docker run/compose` |
| `automation/state.json` | Persistent state machine (source of truth) |
| `automation/work/<slug>/` | Per-automation artifacts copied from `templates/`, plus `tests.json` |
| `automation/reports/environment.json` | Latest capability report |
| `automation/tools/` | `state.py`, `capabilities.py`, `validate_workflow.py`, `testlog.py` |
| `automation/tests/` | Harness self-tests |

## State machine
```
NEW → DISCOVERY_COMPLETE → PLAN_READY → SCOPE_FROZEN → DESIGN_READY → BUILDING → BUILT → INSPECTED → TESTING → VERIFIED
                                                                                   │         ▲            │
                                                                                   └→ FAILED ←┴────────────┘ (also from RETESTING, REPAIRING)
FAILED → DIAGNOSED → REPAIRING → INSPECTED → RETESTING → VERIFIED | FAILED
VERIFIED → READY_FOR_APPROVAL → APPROVED → ACTIVATED      (any of these → DESIGN_READY = change control, wipes approval)
any non-final state → BLOCKED   (leave only via `state.py unblock --by --reason`; resets repair budget)
```
Gates enforced by `state.py`: tool check before BUILDING · workflow file before BUILT · zero static errors before INSPECTED ·
class A–G + root cause before DIAGNOSED · repair budget (`max_repair_iterations`=3, then BLOCKED `HUMAN_INVESTIGATION_REQUIRED`) ·
PASS+no FAIL before VERIFIED · clean re-validation, inactive workflow and `--accept-unverified` (if anything is BLOCKED/NOT_TESTED or runtime wasn't verified) before READY_FOR_APPROVAL ·
`--by/--statement` before APPROVED · APPROVED before ACTIVATED. **`ACTIVATED` only records an activation a human did; nothing here talks to n8n.**
Limit: the tool cannot tell a human from an agent — the "never self-approve" rule is procedural (CLAUDE.md + skill text), the permission `ask` list adds a prompt for Gmail sends.

## Capability levels (`capabilities.py`)
0 no runtime → spec, JSON authoring, static validation · 1 workflow artifact → + code-node tests · 2 live n8n API (reachable + key accepted) → import/execute/inspect · 3 n8n MCP tools observed callable → MCP first, API fallback.
Statuses: `AVAILABLE · AVAILABLE_BUT_UNUSABLE · UNAVAILABLE · NOT_CONFIGURED · NOT_TESTED`. Agent-side tool availability can't be seen by a script, so the agent passes `--observed-tools`; otherwise those rows stay `NOT_TESTED`.
Probes are read-only (`GET /healthz`, `GET /api/v1/workflows?limit=1`); the API key is never printed or stored.

## Static validation (`validate_workflow.py`)
Checks: JSON validity, node structure/duplicates, connections (unknown source/target), missing trigger, disconnected/unreachable nodes (AI sub-nodes handled), dead IF/Switch/classifier branches, expression syntax and node references (incl. Code nodes), credential references, hardcoded secrets (redacted in output), `active` flag, side-effect nodes, error handling.
Result is always `STATICALLY_VERIFIED` or `STATIC_ERRORS_FOUND`, and always `RUNTIME_NOT_TESTED`. It does not prove n8n will run the workflow, and cannot see field-level data shape.

## Test results (`testlog.py`)
Fields: `test_id, description, input, expected, actual, status (PASS|FAIL|BLOCKED|NOT_TESTED), evidence, execution_reference` (+ `scope` STATIC|UNIT|RUNTIME, `attempt`).
Enforced: PASS needs actual + evidence; RUNTIME PASS needs an execution reference; BLOCKED/NOT_TESTED need a reason. Overall level: `STATIC_ONLY → PARTIAL → RUNTIME_VERIFIED`.

## Protocol → harness map
| Protocol § | Where |
|---|---|
| 1 understand, scope freeze | `automation-discovery`, `automation-planner`, `scope.md` |
| 2 environment discovery | `capabilities.py`, discovery skill |
| 3 existing system first / 21 change control | discovery + builder skills; `DESIGN_READY` reopen wipes approval |
| 4–6 design, AI rule, minimal build | `design.md`, planner/builder |
| 7–8 implement, read back, static audit | `n8n-builder`, `n8n-inspector`, `validate_workflow.py` |
| 9 tests, 12 AI validation | `test-plan.md`, `automation-tester`, `testlog.py` |
| 10–11 loop, failure classes | `state.py` controller, `failure-diagnosis` (A–G) |
| 13–18 side effects, idempotency, errors, security, activation gate | CLAUDE.md rules, settings `ask`, `production-readiness`, validator |
| 19–20 docs, completion standard | `documentation.md`, `final-report.md` |
| 22 reusability | add skills/modules only after repetition is proven |

## Usage
```
python3 automation/tools/capabilities.py --observed-tools "<tools you can call>"
python3 automation/tools/state.py show | next
python3 automation/tools/validate_workflow.py <workflow.json> [--json]
python3 automation/tools/testlog.py add --test-id T1 --scope UNIT --status PASS --actual … --evidence …
python3 -m unittest discover -s automation/tests -v
```

## Not built yet (deliberately)
Level-2/3 operations (n8n import/execute/read-back helpers), a Code-node unit-test runner, HTTP stub for external-failure tests, subagents.
