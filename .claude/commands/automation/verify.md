---
description: Run the production-readiness gate, document, and stop for human approval
argument-hint: "[notes]"
---
Verify the current automation. Notes: $ARGUMENTS

1. `python3 automation/tools/state.py show`. Allowed: VERIFIED, READY_FOR_APPROVAL. If TESTING/RETESTING with no failures and at least one PASS, the **automation-tester** skill performs the VERIFIED transition first. Otherwise stop and cite `state.py next`.
2. Use the **production-readiness** skill. Produce the evidence-based final report with VERIFIED / ASSUMED / NOT TESTED labels.
3. Do NOT activate and do NOT record APPROVED/ACTIVATED unless the user explicitly says so in this conversation. Ask for approval and stop.
