# Test Plan — {{name}}

Scope vocabulary: STATIC (JSON checks) · UNIT (code-node logic run locally) · RUNTIME (executed in live n8n, needs execution_reference).
Status vocabulary: PASS · FAIL · BLOCKED · NOT_TESTED. BLOCKED/NOT_TESTED are never PASS.

| test_id | AC | scope | description | input | expected | needs (runtime/creds) | status |
|---|---|---|---|---|---|---|---|
| T1-happy | | | Valid input → expected result | | | | NOT_TESTED |
| T2-invalid | | | Malformed/incomplete input handled safely | | | | NOT_TESTED |
| T3-missing | | | Expected fields absent/null | | | | NOT_TESTED |
| T4-ai-failure | | | AI error/malformed/timeout/unusable | | | | NOT_TESTED |
| T5-external-failure | | | API/db/service fails | | | | NOT_TESTED |
| T6-duplicate | | | Repeated input → no duplicate side effects | | | | NOT_TESTED |
| T7-boundary | | | Key edge case | | | | NOT_TESTED |

Mark a row N/A only with a reason. Results are recorded with `python3 automation/tools/testlog.py add ...`.
Side effects: tests must use test recipients/sandbox sheets or stop at the credential boundary.
