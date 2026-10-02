---
name: automation-repair
description: Applies the smallest repair for a diagnosed failure, within a bounded repair budget (default 3 cycles), then returns to inspection. Use when state is DIAGNOSED or /automation:repair runs.
---

# automation-repair

**Responsibility:** one targeted change per cycle, then back into the loop.

**Inputs:** state `DIAGNOSED`, latest `diagnosis.md` entry.

**Procedure**
1. `state.py transition REPAIRING` — this consumes one repair cycle. At the limit (`max_repair_iterations`, default 3) the tool moves the state to **BLOCKED** with `HUMAN_INVESTIGATION_REQUIRED`: stop, report the diagnoses so far, and do not edit further.
2. Apply the **smallest** change that addresses the stated root cause, only what was diagnosed; no cleanup or scope growth. Don't change expected test values to fit the output unless the diagnosis was class G.
3. Re-run `validate_workflow.py`; `state.py transition INSPECTED` (or `FAILED` if inspection now fails — that costs another cycle).
4. Set up the retest: the next transition is `RETESTING`; rerun the failed tests plus anything in the diagnosis's regression-risk list.
5. Log what changed (file, node, before/after) in `diagnosis.md`.

**Never:** activate, touch credentials, send anything, delete-and-rebuild a working workflow, or make several unrelated edits to "see if it helps".

**Handoff:** `INSPECTED` → `automation-tester` (RETESTING). Budget exhausted → human.
