#!/usr/bin/env python3
"""Test result log. One JSON file per automation: automation/work/<slug>/tests.json.

Record shape: test_id, description, input, expected, actual, status, evidence,
execution_reference (+ scope, attempt, updated_at).

Anti-fabrication rules enforced here, not left to the agent:
  * PASS needs non-empty actual and evidence.
  * scope=RUNTIME + PASS needs a real execution_reference (not NONE).
  * BLOCKED / NOT_TESTED are never promoted to PASS by this tool.
"""
import argparse
import json
import sys
from pathlib import Path

import common

STATUSES = ("PASS", "FAIL", "BLOCKED", "NOT_TESTED")
SCOPES = ("STATIC", "UNIT", "RUNTIME")  # RUNTIME = executed inside a live n8n
EMPTY = {"", "none", "n/a", "na", "-", "null", "todo", "tbd"}


class TestLogError(ValueError):
    pass


def default_path() -> Path:
    state = common.read_json(common.home() / "state.json", {}) or {}
    d = state.get("artifact_dir")
    if not d:
        raise TestLogError("no active automation (state.json has no artifact_dir); pass --file")
    return common.repo_root() / d / "tests.json"


def load(path: Path) -> dict:
    return common.read_json(path, {"tests": []})


def _blank(v) -> bool:
    return v is None or str(v).strip().lower() in EMPTY


def add(path: Path, rec: dict) -> dict:
    status = rec.get("status")
    if status not in STATUSES:
        raise TestLogError(f"status must be one of {STATUSES}, got {status!r}")
    scope = rec.get("scope", "STATIC")
    if scope not in SCOPES:
        raise TestLogError(f"scope must be one of {SCOPES}, got {scope!r}")
    for k in ("test_id", "description"):
        if _blank(rec.get(k)):
            raise TestLogError(f"{k} is required")
    if status == "PASS":
        if _blank(rec.get("actual")) or _blank(rec.get("evidence")):
            raise TestLogError("PASS requires non-empty 'actual' and 'evidence'")
        if scope == "RUNTIME" and _blank(rec.get("execution_reference")):
            raise TestLogError("RUNTIME PASS requires an execution_reference (live n8n execution id/url)")
    if status in ("BLOCKED", "NOT_TESTED") and _blank(rec.get("evidence")):
        raise TestLogError(f"{status} requires 'evidence' stating why (e.g. 'no n8n runtime')")
    data = load(path)
    tests = data.setdefault("tests", [])
    old = next((t for t in tests if t["test_id"] == rec["test_id"]), None)
    full = {
        "test_id": rec["test_id"],
        "description": rec["description"],
        "scope": scope,
        "input": rec.get("input", ""),
        "expected": rec.get("expected", ""),
        "actual": rec.get("actual", ""),
        "status": status,
        "evidence": rec.get("evidence", ""),
        "execution_reference": rec.get("execution_reference") or "NONE",
        "attempt": (old["attempt"] + 1) if old else 1,
        "updated_at": common.now(),
    }
    if old:
        tests[tests.index(old)] = full
    else:
        tests.append(full)
    common.write_json(path, data)
    return full


def summarize(path: Path) -> dict:
    tests = load(path).get("tests", [])
    counts = {s: 0 for s in STATUSES}
    for t in tests:
        counts[t["status"]] += 1
    runtime_pass = sum(1 for t in tests if t["status"] == "PASS" and t["scope"] == "RUNTIME")
    unverified = counts["BLOCKED"] + counts["NOT_TESTED"]
    return {
        "total": len(tests),
        "counts": counts,
        "failing": [t["test_id"] for t in tests if t["status"] == "FAIL"],
        "unverified": [t["test_id"] for t in tests if t["status"] in ("BLOCKED", "NOT_TESTED")],
        "unverified_count": unverified,
        "runtime_pass": runtime_pass,
        # RUNTIME_VERIFIED only if something really ran in n8n and nothing is left unverified.
        "verification": ("RUNTIME_VERIFIED" if runtime_pass and not unverified and not counts["FAIL"]
                         else "STATIC_ONLY" if counts["PASS"] and not runtime_pass
                         else "PARTIAL" if counts["PASS"] else "NONE"),
    }


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--file", help="tests.json path (default: active automation's)")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add", help="add or update (by test_id) a test result")
    for f in ("test-id", "description", "input", "expected", "actual", "evidence", "execution-reference"):
        a.add_argument(f"--{f}", default="")
    a.add_argument("--status", required=True, choices=STATUSES)
    a.add_argument("--scope", default="STATIC", choices=SCOPES)
    sub.add_parser("summary", help="print counts and verification level")
    sub.add_parser("list", help="print all records")
    args = p.parse_args(argv)
    try:
        path = Path(args.file) if args.file else default_path()
        if args.cmd == "add":
            rec = {k.replace("-", "_"): v for k, v in vars(args).items() if k not in ("file", "cmd")}
            print(json.dumps(add(path, rec), indent=2))
        elif args.cmd == "summary":
            print(json.dumps(summarize(path), indent=2))
        else:
            print(json.dumps(load(path), indent=2))
    except TestLogError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
