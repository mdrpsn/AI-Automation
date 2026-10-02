#!/usr/bin/env python3
"""Persistent state machine + build/test/repair controller. Source of truth: automation/state.json.

    python3 automation/tools/state.py show | next | init NAME | transition STATE [flags] | unblock ... | history

Guards live here (not in prose) so an agent cannot skip gates by forgetting them:
  * DESIGN_READY -> BUILDING needs a fresh environment report (TOOL CHECK).
  * BUILT -> INSPECTED needs a static report with zero errors.
  * DIAGNOSED -> REPAIRING is bounded by max_repair_iterations (default 3), then BLOCKED.
  * VERIFIED needs tests with >=1 PASS and no FAIL.
  * READY_FOR_APPROVAL needs a clean re-validation, workflow inactive, and either no
    BLOCKED/NOT_TESTED tests or an explicit --accept-unverified reason.
  * APPROVED needs --by/--statement; ACTIVATED needs APPROVED. This tool never touches n8n:
    ACTIVATED only RECORDS an activation a human performed.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import common
import testlog
import validate_workflow

STATES = ["NEW", "DISCOVERY_COMPLETE", "PLAN_READY", "SCOPE_FROZEN", "DESIGN_READY", "BUILDING", "BUILT",
          "INSPECTED", "TESTING", "FAILED", "DIAGNOSED", "REPAIRING", "RETESTING", "VERIFIED",
          "READY_FOR_APPROVAL", "APPROVED", "ACTIVATED", "BLOCKED"]
TRANSITIONS = {
    "NEW": ["DISCOVERY_COMPLETE"],
    "DISCOVERY_COMPLETE": ["PLAN_READY"],
    "PLAN_READY": ["SCOPE_FROZEN"],
    "SCOPE_FROZEN": ["DESIGN_READY", "PLAN_READY"],
    "DESIGN_READY": ["BUILDING", "PLAN_READY"],
    "BUILDING": ["BUILT"],
    "BUILT": ["INSPECTED", "FAILED"],
    "INSPECTED": ["TESTING", "RETESTING"],      # which one is decided by retest_pending
    "TESTING": ["VERIFIED", "FAILED"],
    "FAILED": ["DIAGNOSED"],
    "DIAGNOSED": ["REPAIRING"],
    "REPAIRING": ["INSPECTED", "FAILED"],
    "RETESTING": ["VERIFIED", "FAILED"],
    "VERIFIED": ["READY_FOR_APPROVAL", "DESIGN_READY"],
    "READY_FOR_APPROVAL": ["APPROVED", "DESIGN_READY"],
    "APPROVED": ["ACTIVATED", "DESIGN_READY"],
    "ACTIVATED": ["DESIGN_READY"],               # change control: any edit starts a new cycle
    "BLOCKED": [],                               # leave only via `unblock` (human decision)
}
NEXT_ACTION = {
    "NEW": ("/automation:new", "automation-discovery", "Run discovery for the requirement."),
    "DISCOVERY_COMPLETE": ("/automation:plan", "automation-planner", "Write scope freeze + design."),
    "PLAN_READY": ("/automation:plan", "automation-planner", "Get the scope frozen (needs user approval)."),
    "SCOPE_FROZEN": ("/automation:plan", "automation-planner", "Finish the design."),
    "DESIGN_READY": ("/automation:build", "n8n-builder", "Run capabilities.py (TOOL CHECK), then build."),
    "BUILDING": ("/automation:build", "n8n-builder", "Finish authoring and read the workflow back."),
    "BUILT": ("/automation:inspect", "n8n-inspector", "Static inspection of the built workflow."),
    "INSPECTED": ("/automation:test", "automation-tester", "Run the test plan."),
    "TESTING": ("/automation:test", "automation-tester", "Finish recording test results."),
    "FAILED": ("/automation:repair", "failure-diagnosis", "Diagnose the failure (classify A-G, root cause)."),
    "DIAGNOSED": ("/automation:repair", "automation-repair", "Apply the smallest repair."),
    "REPAIRING": ("/automation:repair", "automation-repair", "Finish repair, then re-inspect."),
    "RETESTING": ("/automation:test", "automation-tester", "Re-run affected + regression tests."),
    "VERIFIED": ("/automation:verify", "production-readiness", "Run the activation-gate checklist."),
    "READY_FOR_APPROVAL": ("(human)", "production-readiness", "Waiting for explicit human approval."),
    "APPROVED": ("(human)", None, "Human activates in n8n, then records ACTIVATED."),
    "ACTIVATED": ("/automation:status", None, "Done. Any change => transition DESIGN_READY."),
    "BLOCKED": ("(human)", None, "Human investigation required; see blocked.reason."),
}
DEFAULT_MAX_REPAIRS = 3
SAFE_DEFAULTS = {"workflow_active": False, "external_side_effects_enabled": False,
                 "credentials_modified": False, "production_activation_authorized": False}


class StateError(Exception):
    pass


def path() -> Path:
    return common.home() / "state.json"


def fresh() -> dict:
    return {"schema_version": 1, "name": None, "slug": None, "state": "NEW", "artifact_dir": None,
            "workflow_path": None, "capability_level": None, "environment_report": None,
            "max_repair_iterations": DEFAULT_MAX_REPAIRS, "repair_iterations": 0, "retest_pending": False, "tested": False,
            "verification": None, "inspection": None, "approval": None, "activation": None, "blocked": None,
            "diagnoses": [], "safety": dict(SAFE_DEFAULTS), "history": []}


def load() -> dict:
    s = common.read_json(path())
    if s is None:
        raise StateError(f"{path()} not found")
    return s


def save(s: dict) -> None:
    common.write_json(path(), s)


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "automation"


def init(name: str, force: bool = False) -> dict:
    cur = common.read_json(path())
    if cur and cur.get("name") and cur["state"] not in ("ACTIVATED",) and not force:
        raise StateError(f"automation {cur['name']!r} is in state {cur['state']}; finish it or pass --force")
    s = fresh()
    s["name"], s["slug"] = name, slugify(name)
    s["artifact_dir"] = f"automation/work/{s['slug']}"
    s["workflow_path"] = f"{s['slug']}/workflow.json"
    work = common.repo_root() / s["artifact_dir"]
    work.mkdir(parents=True, exist_ok=True)
    tpl = common.home() / "templates"
    for t in sorted(tpl.glob("*.md")) if tpl.exists() else []:
        if not (work / t.name).exists():
            (work / t.name).write_text(t.read_text().replace("{{name}}", name))
    s["history"].append({"at": common.now(), "from": None, "to": "NEW", "note": f"init {name!r}"})
    save(s)
    return s


def _env_report_ok(s: dict) -> dict:
    rep = common.read_json(common.home() / "reports" / "environment.json")
    if not rep or "capability_level" not in rep:
        raise StateError("TOOL CHECK missing: run `python3 automation/tools/capabilities.py` first")
    return rep


def _workflow(s: dict) -> Path:
    if not s.get("workflow_path"):
        raise StateError("workflow_path not set")
    p = common.repo_root() / s["workflow_path"]
    if not p.exists():
        raise StateError(f"workflow file not found: {p}")
    return p


def transition(to: str, note: str = "", **kw) -> dict:
    s = load()
    cur = s["state"]
    if to not in STATES:
        raise StateError(f"unknown state {to!r}")
    if not s["name"]:
        raise StateError("no active automation; run `state.py init NAME` first")
    if to == "BLOCKED":
        if cur in ("ACTIVATED", "BLOCKED"):
            raise StateError(f"cannot block from {cur}")
        s["blocked"] = {"from": cur, "reason": note or "unspecified", "at": common.now()}
        return save_with(s, to, note)
    if to not in TRANSITIONS.get(cur, []):
        raise StateError(f"illegal transition {cur} -> {to}; allowed: {TRANSITIONS.get(cur) or 'none (use unblock)'}")

    if to == "TESTING":
        if s["retest_pending"]:
            raise StateError("a repair is pending retest: use RETESTING, not TESTING")
        s["tested"] = True
    elif to == "RETESTING" and not s["retest_pending"]:
        raise StateError("RETESTING only follows a repair of a tested workflow; use TESTING")
    elif to == "BUILDING":
        rep = _env_report_ok(s)
        s["capability_level"], s["environment_report"] = rep["capability_level"], rep.get("generated_at")
    elif to == "BUILT":
        _workflow(s)
    elif to == "INSPECTED":  # from BUILT or REPAIRING
        rep = validate_workflow.validate_file(_workflow(s))
        s["inspection"] = {"at": common.now(), "verification": rep["verification"], "errors": rep["error_count"],
                           "warnings": rep["warning_count"], "runtime": rep["runtime"]}
        if rep["error_count"]:
            save(s)  # record the failed inspection, but do not advance
            raise StateError(f"static inspection found {rep['error_count']} error(s); transition to FAILED "
                             "(run validate_workflow.py for details)")
        s["retest_pending"] = cur == "REPAIRING" and s["tested"]
    elif to == "DIAGNOSED":
        if kw.get("failure_class") not in list("ABCDEFG") or not kw.get("root_cause"):
            raise StateError("DIAGNOSED needs --failure-class A-G and --root-cause")
        s["diagnoses"].append({"at": common.now(), "class": kw["failure_class"], "root_cause": kw["root_cause"],
                               "iteration": s["repair_iterations"] + 1})
    elif to == "REPAIRING":
        if s["repair_iterations"] >= s["max_repair_iterations"]:
            reason = (f"HUMAN_INVESTIGATION_REQUIRED: {s['repair_iterations']} repair cycle(s) exhausted "
                      f"(max {s['max_repair_iterations']}); last root cause: {s['diagnoses'][-1]['root_cause']}")
            s["blocked"] = {"from": cur, "reason": reason, "at": common.now()}
            save_with(s, "BLOCKED", reason)
            raise StateError(f"{reason}. State is now BLOCKED.")
        s["repair_iterations"] += 1
    elif to == "VERIFIED":
        summ = testlog.summarize(common.repo_root() / s["artifact_dir"] / "tests.json")
        if summ["counts"]["FAIL"] or not summ["counts"]["PASS"]:
            raise StateError(f"VERIFIED needs >=1 PASS and 0 FAIL; got {summ['counts']}")
        s["verification"] = {"at": common.now(), "level": summ["verification"], "unverified": summ["unverified"],
                             "unverified_count": summ["unverified_count"], "counts": summ["counts"]}
        s["retest_pending"] = False
    elif to == "READY_FOR_APPROVAL":
        rep = validate_workflow.validate_file(_workflow(s))
        if rep["error_count"]:
            raise StateError(f"re-validation has {rep['error_count']} error(s) (e.g. workflow active); fix first")
        s["safety"]["workflow_active"] = bool(rep.get("active"))
        v = s["verification"] or {}
        if v.get("unverified_count") or v.get("level") != "RUNTIME_VERIFIED":
            if not kw.get("accept_unverified"):
                raise StateError(f"verification level is {v.get('level')} with {v.get('unverified_count')} "
                                 "BLOCKED/NOT_TESTED test(s); pass --accept-unverified '<reason>' (human risk acceptance)")
            v["accepted_unverified"] = kw["accept_unverified"]
    elif to == "APPROVED":
        if not kw.get("by") or not kw.get("statement"):
            raise StateError("APPROVED needs --by and --statement quoting the human's explicit approval")
        s["approval"] = {"by": kw["by"], "statement": kw["statement"], "at": common.now()}
        s["safety"]["production_activation_authorized"] = True
    elif to == "ACTIVATED":
        if not kw.get("evidence"):
            raise StateError("ACTIVATED needs --evidence (who activated it in n8n, when). This tool does not activate anything.")
        s["activation"] = {"evidence": kw["evidence"], "at": common.now()}
        s["safety"]["workflow_active"] = True
    elif to == "DESIGN_READY" and cur in ("VERIFIED", "READY_FOR_APPROVAL", "APPROVED", "ACTIVATED"):
        s["approval"] = s["activation"] = s["verification"] = None   # a change invalidates approval
        s["retest_pending"], s["tested"], s["repair_iterations"] = False, False, 0
        s["safety"] = dict(SAFE_DEFAULTS)
    return save_with(s, to, note)


def save_with(s: dict, to: str, note: str) -> dict:
    s["history"].append({"at": common.now(), "from": s["state"], "to": to, "note": note})
    s["state"] = to
    save(s)
    return s


def unblock(to: str, by: str, reason: str) -> dict:
    s = load()
    if s["state"] != "BLOCKED":
        raise StateError("not BLOCKED")
    if to not in STATES or to in ("BLOCKED", "APPROVED", "ACTIVATED"):
        raise StateError("unblock target must be a non-terminal, non-approval state")
    s["history"].append({"at": common.now(), "from": "BLOCKED", "to": to, "note": f"unblocked by {by}: {reason}"})
    s["state"], s["blocked"] = to, None
    s["repair_iterations"] = 0   # a human decision grants a fresh repair budget
    save(s)
    return s


def next_action(s: dict) -> dict:
    cmd, skill, why = NEXT_ACTION[s["state"]]
    left = s["max_repair_iterations"] - s["repair_iterations"]
    if s["state"] == "BLOCKED":
        why = f"{why} Reason: {(s['blocked'] or {}).get('reason')}"
    if s["state"] in ("FAILED", "DIAGNOSED", "REPAIRING"):
        why += f" (repair cycles left: {left}/{s['max_repair_iterations']})"
    return {"state": s["state"], "command": cmd, "skill": skill, "why": why}


def _kv(argv_pairs):
    return {k.replace("-", "_"): v for k, v in argv_pairs.items() if v is not None}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    sub.add_parser("next")
    sub.add_parser("history")
    i = sub.add_parser("init")
    i.add_argument("name")
    i.add_argument("--force", action="store_true")
    t = sub.add_parser("transition")
    t.add_argument("to")
    t.add_argument("--note", default="")
    for f in ("failure-class", "root-cause", "accept-unverified", "by", "statement", "evidence"):
        t.add_argument(f"--{f}")
    u = sub.add_parser("unblock")
    u.add_argument("to")
    u.add_argument("--by", required=True)
    u.add_argument("--reason", required=True)
    s_ = sub.add_parser("set", help="set workflow_path or max_repair_iterations")
    s_.add_argument("--workflow-path")
    s_.add_argument("--max-repair-iterations", type=int)
    a = p.parse_args(argv)
    try:
        if a.cmd == "init":
            out = init(a.name, a.force)
        elif a.cmd == "show":
            out = load()
        elif a.cmd == "history":
            out = load()["history"]
        elif a.cmd == "next":
            out = next_action(load())
        elif a.cmd == "unblock":
            out = unblock(a.to, a.by, a.reason)
        elif a.cmd == "set":
            out = load()
            if a.workflow_path:
                out["workflow_path"] = a.workflow_path
            if a.max_repair_iterations:
                out["max_repair_iterations"] = a.max_repair_iterations
            save(out)
        else:
            kw = _kv({k: v for k, v in vars(a).items() if k not in ("cmd", "to", "note")})
            out = transition(a.to, a.note, **kw)
        print(json.dumps(out, indent=2))
        return 0
    except (StateError, testlog.TestLogError) as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
