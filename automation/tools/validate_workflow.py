#!/usr/bin/env python3
"""Static validator for n8n workflow JSON exports (stdlib only).

STATIC ONLY. A clean result means "STATICALLY_VERIFIED": the JSON is well formed and
internally consistent. It says nothing about whether n8n will run it correctly
(RUNTIME_NOT_TESTED is always reported). Exit code: 0 no errors, 1 errors, 2 unreadable.
"""
import argparse
import json
import re
import sys
from collections import deque
from pathlib import Path

SEV_ORDER = {"ERROR": 0, "WARN": 1, "INFO": 2}

# Credential-bearing node types (matched on the part after the last '.').
NEEDS_CREDENTIAL = {
    "gmail", "gmailTrigger", "googleSheets", "googleSheetsTrigger", "googleDrive", "googleCalendar",
    "slack", "twilio", "telegram", "telegramTrigger", "openAi", "postgres", "mySql", "mongoDb",
    "airtable", "notion", "hubspot", "salesforce", "stripe", "emailSend", "emailReadImap",
}
NEEDS_CREDENTIAL_PREFIXES = ("lmChat", "embeddings", "vectorStore")
# Types that act on the outside world. Read-only operations are exempted below.
SIDE_EFFECT = NEEDS_CREDENTIAL - {"gmailTrigger", "googleSheetsTrigger", "telegramTrigger", "emailReadImap"}
SIDE_EFFECT |= {"httpRequest", "executeCommand", "ssh", "readWriteFile", "ftp", "sendGrid", "whatsApp"}
READ_OPS = {"get", "getAll", "getMany", "read", "search", "list", "getThread", "getAllThreads", "select"}
SECRET_KEYS = {"apikey", "secret", "clientsecret", "password", "token", "accesstoken", "authorization",
               "privatekey", "bearer"}
SECRET_PATTERNS = {
    "OpenAI/Anthropic-style key": r"\bsk-[A-Za-z0-9_-]{20,}",
    "Google API key": r"\bAIza[0-9A-Za-z_-]{35}",
    "GitHub token": r"\bgh[pousr]_[A-Za-z0-9]{30,}",
    "Slack token": r"\bxox[baprs]-[A-Za-z0-9-]{10,}",
    "AWS access key": r"\bAKIA[0-9A-Z]{16}\b",
    "Bearer token": r"\bBearer\s+[A-Za-z0-9._~+/=-]{20,}",
    "Private key block": r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
}
REF_PATTERNS = [r"\$\(\s*['\"](.+?)['\"]\s*\)", r"\$node\[\s*['\"](.+?)['\"]\s*\]",
                r"\$items\(\s*['\"](.+?)['\"]"]
CODE_KEYS = {"jsCode", "pythonCode", "functionCode"}
PLACEHOLDER = re.compile(r"^(<.*>|YOUR[_ -].*|REPLACE.*|CHANGE.*|xxx+|\*+)$", re.I)


def _short(t: str) -> str:
    return t.rsplit(".", 1)[-1]


def _is_trigger(n: dict) -> bool:
    t = _short(n.get("type", ""))
    return "trigger" in t.lower() or t in ("webhook", "start")


def _walk(obj, path=""):
    """Yield (path, key, value) for every scalar in a nested structure."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk(v, f"{path}[{i}]")
    else:
        yield path, path.rsplit(".", 1)[-1].split("[")[0], obj


def validate(wf) -> dict:
    findings = []

    def add(sev, code, msg, node=None):
        findings.append({"severity": sev, "code": code, "node": node, "message": msg})

    meta = {"node_count": 0, "trigger_nodes": [], "side_effect_nodes": [], "credentials_required": [],
            "active": None}

    def report():
        findings.sort(key=lambda f: SEV_ORDER[f["severity"]])
        errors = sum(f["severity"] == "ERROR" for f in findings)
        return {
            "verification": "STATICALLY_VERIFIED" if not errors else "STATIC_ERRORS_FOUND",
            "runtime": "RUNTIME_NOT_TESTED",
            "disclaimer": "Static checks only; these do not prove the workflow behaves correctly in n8n.",
            "error_count": errors,
            "warning_count": sum(f["severity"] == "WARN" for f in findings),
            **meta, "findings": findings,
        }

    if not isinstance(wf, dict):
        add("ERROR", "NOT_AN_OBJECT", "Top-level JSON value must be an object")
        return report()
    nodes, conns = wf.get("nodes"), wf.get("connections")
    if not isinstance(nodes, list) or not nodes:
        add("ERROR", "NO_NODES", "'nodes' must be a non-empty list")
        return report()
    if not isinstance(conns, dict):
        add("ERROR", "BAD_CONNECTIONS", "'connections' must be an object")
        conns = {}

    meta["node_count"] = len(nodes)
    meta["active"] = wf.get("active")
    if wf.get("active") is True:
        add("ERROR", "ACTIVE_WORKFLOW", "'active' is true; the harness requires workflows to stay inactive until approved")
    elif "active" not in wf:
        add("INFO", "ACTIVE_UNSPECIFIED", "'active' not set; n8n imports workflows inactive, but confirm after import")

    # --- node structure -------------------------------------------------------------
    by_name = {}
    for i, n in enumerate(nodes):
        if not isinstance(n, dict):
            add("ERROR", "BAD_NODE", f"nodes[{i}] is not an object")
            continue
        name, ntype = n.get("name"), n.get("type")
        if not name or not ntype:
            add("ERROR", "NODE_MISSING_FIELDS", f"nodes[{i}] missing name or type", name)
            continue
        if name in by_name:
            add("ERROR", "DUPLICATE_NODE_NAME", f"Duplicate node name {name!r}", name)
        by_name[name] = n
        if "typeVersion" not in n:
            add("WARN", "NO_TYPE_VERSION", "typeVersion missing", name)
        pos = n.get("position")
        if not (isinstance(pos, list) and len(pos) == 2):
            add("WARN", "NO_POSITION", "position missing/invalid (n8n canvas import may fail)", name)
        if not isinstance(n.get("parameters", {}), dict):
            add("ERROR", "BAD_PARAMETERS", "parameters must be an object", name)
        if n.get("disabled"):
            add("INFO", "DISABLED_NODE", "Node is disabled", name)

    # --- connections ---------------------------------------------------------------
    main_edges = {k: set() for k in by_name}      # source -> targets (main)
    sub_edges = {k: set() for k in by_name}       # sub-node -> parents (ai_* etc.)
    incoming = {k: 0 for k in by_name}
    for src, kinds in conns.items():
        if src not in by_name:
            add("ERROR", "CONNECTION_FROM_UNKNOWN_NODE", f"connections key {src!r} is not a node", src)
            continue
        if not isinstance(kinds, dict):
            add("ERROR", "BAD_CONNECTIONS", f"connections[{src!r}] must be an object", src)
            continue
        for kind, outputs in kinds.items():
            if not isinstance(outputs, list):
                add("ERROR", "BAD_CONNECTIONS", f"connections[{src!r}][{kind!r}] must be a list", src)
                continue
            for oi, targets in enumerate(outputs):
                if targets is None:
                    continue
                if not isinstance(targets, list):
                    add("ERROR", "BAD_CONNECTIONS", f"{src!r} {kind}[{oi}] must be a list", src)
                    continue
                for t in targets:
                    tn = t.get("node") if isinstance(t, dict) else None
                    if tn not in by_name:
                        add("ERROR", "CONNECTION_TO_UNKNOWN_NODE",
                            f"{src!r} {kind}[{oi}] points to missing node {tn!r}", src)
                        continue
                    incoming[tn] += 1
                    (main_edges if kind == "main" else sub_edges)[src].add(tn)

    # --- triggers & reachability ----------------------------------------------------
    triggers = [k for k, n in by_name.items() if _is_trigger(n)]
    meta["trigger_nodes"] = triggers
    if not triggers:
        add("ERROR", "NO_TRIGGER", "No trigger node (webhook/schedule/*Trigger) found")
    reach, q = set(triggers), deque(triggers)
    while q:
        for nxt in main_edges.get(q.popleft(), ()):
            if nxt not in reach:
                reach.add(nxt)
                q.append(nxt)
    changed = True
    while changed:                                  # sub-nodes are live if their parent is
        changed = False
        for sub, parents in sub_edges.items():
            if sub not in reach and parents & reach:
                reach.add(sub)
                changed = True
                for nxt in main_edges.get(sub, ()):
                    reach.add(nxt)
    for k, n in by_name.items():
        if k in reach or n["type"].endswith("stickyNote"):
            continue
        has_edges = incoming[k] or main_edges[k] or sub_edges[k]
        add("ERROR", "UNREACHABLE_NODE" if has_edges else "DISCONNECTED_NODE",
            "Node is " + ("not reachable from any trigger" if has_edges else "not connected to anything"), k)

    # --- suspicious dead branches ---------------------------------------------------
    for k, n in by_name.items():
        t = _short(n["type"])
        outs = conns.get(k, {}).get("main", []) if isinstance(conns.get(k), dict) else []
        expected = None
        if t == "if":
            expected = 2
        elif t == "switch":
            rules = (n.get("parameters", {}).get("rules") or {}).get("values") or n.get("parameters", {}).get("rules")
            if isinstance(rules, list):
                expected = len(rules) + (1 if (n.get("parameters", {}).get("options") or {}).get("fallbackOutput") == "extra" else 0)
        elif t == "textClassifier":
            cats = (n.get("parameters", {}).get("categories") or {}).get("categories")
            if isinstance(cats, list):
                expected = len(cats)
        if expected:
            empty = [i for i in range(expected) if i >= len(outs) or not outs[i]]
            if empty:
                add("WARN", "DEAD_BRANCH", f"{t} output(s) {empty} lead nowhere (intentional drop? confirm)", k)

    # --- expressions ---------------------------------------------------------------
    for k, n in by_name.items():
        for path, key, val in _walk(n.get("parameters", {})):
            if not isinstance(val, str):
                continue
            is_code = key in CODE_KEYS
            is_expr = val.startswith("=")
            if not (is_expr or is_code or "{{" in val):
                continue
            if "{{" in val and not (is_expr or is_code) and not n["type"].endswith("stickyNote"):
                add("WARN", "EXPRESSION_WITHOUT_EQUALS", f"{path}: contains '{{{{' but does not start with '=' (won't be evaluated)", k)
            if is_expr and val.count("{{") != val.count("}}"):
                add("ERROR", "UNBALANCED_EXPRESSION", f"{path}: unbalanced '{{{{ }}}}'", k)
            for pat in REF_PATTERNS:
                for ref in re.findall(pat, val):
                    if ref not in by_name:
                        add("ERROR", "INVALID_NODE_REFERENCE", f"{path}: references unknown node {ref!r}", k)
                    elif ref == k and not is_code:
                        add("WARN", "SELF_REFERENCE", f"{path}: node references its own output", k)

    # --- credentials ---------------------------------------------------------------
    for k, n in by_name.items():
        t = _short(n["type"])
        creds = n.get("credentials")
        wants = t in NEEDS_CREDENTIAL or t.startswith(NEEDS_CREDENTIAL_PREFIXES)
        if t == "httpRequest" and (n.get("parameters", {}).get("authentication") in ("predefinedCredentialType", "genericCredentialType")):
            wants = True
        if isinstance(creds, dict) and creds:
            for ctype, ref in creds.items():
                meta["credentials_required"].append({"node": k, "credential_type": ctype})
                if not isinstance(ref, dict) or not ref.get("id"):
                    add("WARN", "CREDENTIAL_REF_INCOMPLETE", f"credential {ctype!r} has no id; bind in n8n UI", k)
                elif set(ref) - {"id", "name"}:
                    add("ERROR", "CREDENTIAL_INLINE_VALUES", f"credential {ctype!r} carries inline fields {sorted(set(ref) - {'id', 'name'})}", k)
        elif wants:
            meta["credentials_required"].append({"node": k, "credential_type": "UNBOUND"})
            add("WARN", "MISSING_CREDENTIAL_REFERENCE", f"{t} normally needs a credential; none referenced (fine for sanitized exports)", k)

    # --- hardcoded secrets (values are never echoed) ---------------------------------
    for path, key, val in _walk(wf):
        if not isinstance(val, str) or not val.strip():
            continue
        node = None
        for label, pat in SECRET_PATTERNS.items():
            if re.search(pat, val):
                add("ERROR", "HARDCODED_SECRET", f"{path}: looks like a {label} ({val[:4]}…redacted)", node)
        norm = re.sub(r"[-_ ]", "", key).lower()
        if norm in SECRET_KEYS and not val.startswith("=") and len(val) >= 8 and not PLACEHOLDER.match(val):
            add("WARN", "SUSPECT_SECRET_FIELD", f"{path}: literal value in a secret-named field (redacted)", node)
    for k, n in by_name.items():                    # {"name": "Authorization", "value": "..."} pairs
        for path, d in _dicts(n.get("parameters", {})):
            nm, v = d.get("name"), d.get("value")
            if isinstance(nm, str) and re.sub(r"[-_ ]", "", nm).lower() in SECRET_KEYS \
                    and isinstance(v, str) and v and not v.startswith("=") and not PLACEHOLDER.match(v):
                add("WARN", "SUSPECT_SECRET_FIELD", f"{path}: header/param {nm!r} has a literal value (redacted)", k)

    # --- side effects & error handling ---------------------------------------------
    for k, n in by_name.items():
        t = _short(n["type"])
        p = n.get("parameters", {})
        op = p.get("operation")
        if t in SIDE_EFFECT and op not in READ_OPS and not (t == "httpRequest" and str(p.get("method", "GET")).upper() in ("GET", "HEAD")):
            meta["side_effect_nodes"].append({"node": k, "type": t, "operation": op or p.get("method") or "(default)"})
    if meta["side_effect_nodes"]:
        add("INFO", "SIDE_EFFECT_NODES", f"{len(meta['side_effect_nodes'])} node(s) act on external systems; tests must not trigger them against production")
    handled = (wf.get("settings") or {}).get("errorWorkflow") or any(
        n.get("onError") in ("continueErrorOutput", "continueRegularOutput") or n.get("continueOnFail")
        for n in by_name.values())
    if not handled:
        add("WARN", "NO_ERROR_HANDLING", "No errorWorkflow, onError, or continueOnFail anywhere; failures only appear in n8n execution history")

    return report()


def _dicts(obj, path=""):
    if isinstance(obj, dict):
        yield path, obj
        for k, v in obj.items():
            yield from _dicts(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _dicts(v, f"{path}[{i}]")


def validate_file(path) -> dict:
    path = Path(path)
    try:
        wf = json.loads(path.read_text())
    except FileNotFoundError:
        return {"file": str(path), "verification": "UNREADABLE", "runtime": "RUNTIME_NOT_TESTED",
                "error_count": 1, "warning_count": 0,
                "findings": [{"severity": "ERROR", "code": "FILE_NOT_FOUND", "node": None, "message": str(path)}]}
    except json.JSONDecodeError as e:
        return {"file": str(path), "verification": "UNREADABLE", "runtime": "RUNTIME_NOT_TESTED",
                "error_count": 1, "warning_count": 0,
                "findings": [{"severity": "ERROR", "code": "INVALID_JSON", "node": None, "message": str(e)}]}
    rep = validate(wf)
    rep["file"] = str(path)
    return rep


def render(rep: dict) -> str:
    out = [f"{rep.get('file', '')}", f"  {rep['verification']} | {rep['runtime']} | "
           f"errors={rep['error_count']} warnings={rep['warning_count']} nodes={rep.get('node_count', '?')} "
           f"triggers={rep.get('trigger_nodes')}"]
    for f in rep["findings"]:
        out.append(f"  [{f['severity']:5}] {f['code']}" + (f" ({f['node']})" if f["node"] else "") + f": {f['message']}")
    out.append("  NOTE: static checks only; runtime behavior is untested.")
    return "\n".join(out)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Statically validate n8n workflow JSON file(s).")
    p.add_argument("files", nargs="+")
    p.add_argument("--json", action="store_true", help="emit JSON")
    p.add_argument("--out", help="also write the (first file's) JSON report here")
    args = p.parse_args(argv)
    reps = [validate_file(f) for f in args.files]
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(reps[0], indent=2) + "\n")
    print(json.dumps(reps if len(reps) > 1 else reps[0], indent=2) if args.json else "\n".join(map(render, reps)))
    if any(r["verification"] == "UNREADABLE" for r in reps):
        return 2
    return 1 if any(r["error_count"] for r in reps) else 0


if __name__ == "__main__":
    sys.exit(main())
