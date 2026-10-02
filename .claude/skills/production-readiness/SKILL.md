---
name: production-readiness
description: Evaluates the activation gate for a VERIFIED workflow, produces documentation and the evidence-based final report, and stops for explicit human approval. Never activates. Use after VERIFIED or when /automation:verify runs.
---

# production-readiness

**Responsibility:** decide READY / NOT READY honestly, document, and hand to a human.

**Inputs:** state `VERIFIED`, `tests.json`, `readiness.md`, workflow file, `documentation.md`.

**Procedure**
1. Fill `readiness.md`; every gate is `VERIFIED` / `ASSUMED` / `NOT TESTED` with evidence: acceptance criteria, tests (list every BLOCKED/NOT_TESTED), credentials configured (names only), endpoints, prod vs test, error handling, side effects, duplicates, observability, no secrets (validator), workflow inactive.
2. Write `documentation.md` and the repo-convention `<slug>/README.md` (purpose, trigger, inputs, flow, AI components, systems, failure handling, credentials needed, tests incl. what was *not* run, limitations, activation requirements, future improvements).
3. Fill `final-report.md` format (BUILD STATUS … ACTIVATION READY/NOT READY).
4. If the verification level is not `RUNTIME_VERIFIED`, the report must say `RUNTIME NOT TESTED` and the list of unverified tests; verdict is **NOT READY** for production use, or ready only for human review of a statically verified draft.
5. `state.py transition READY_FOR_APPROVAL [--accept-unverified "<reason>"]` — the flag is a human risk acceptance: use it only if the user said so.

**Approval is not yours to give.** Present the report and ask. Only after the user explicitly authorizes: `transition APPROVED --by "<name>" --statement "<their words>"`. Activation itself is performed by a human in n8n (this harness never activates); then record `transition ACTIVATED --evidence "<who/when>"`.

**Handoff:** `READY_FOR_APPROVAL` → human. Gaps found → `DESIGN_READY` (change control) or repair loop.
