#!/usr/bin/env python3
"""Capability detector. Probes the real environment and writes automation/reports/environment.json.

Statuses: AVAILABLE | AVAILABLE_BUT_UNUSABLE | UNAVAILABLE | NOT_CONFIGURED | NOT_TESTED
Nothing is assumed from config files alone. A script cannot see the agent's callable tools,
so the agent passes what it actually observed:

    python3 automation/tools/capabilities.py \\
        --observed-tools "mcp__github__get_me,mcp__Gmail__search_threads,..." [--workflow path] [--no-write]

Without --observed-tools, tool-level checks stay NOT_TESTED (never guessed).
Probing is read-only: GET /healthz and GET /api/v1/workflows?limit=1. The API key is never printed.

Capability level (highest satisfied):
  3 n8n MCP tools callable   2 live n8n API usable   1 workflow JSON exists   0 nothing
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

import common

AVAILABLE, BUT_UNUSABLE, UNAVAILABLE, NOT_CONFIGURED, NOT_TESTED = (
    "AVAILABLE", "AVAILABLE_BUT_UNUSABLE", "UNAVAILABLE", "NOT_CONFIGURED", "NOT_TESTED")


def item(status, detail="", **extra):
    return {"status": status, "detail": detail, **extra}


def _run(cmd, timeout=8):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).strip()
    except FileNotFoundError:
        return 127, "not found"
    except subprocess.TimeoutExpired:
        return 124, "timed out"


def _http(url, headers=None, timeout=4):
    """GET without following proxies for loopback. Returns (status_code|None, error|None)."""
    host = urlparse(url).hostname or ""
    opener = (urllib.request.build_opener(urllib.request.ProxyHandler({}))
              if host in ("localhost", "127.0.0.1", "::1") else urllib.request.build_opener())
    try:
        with opener.open(urllib.request.Request(url, headers=headers or {}), timeout=timeout) as r:
            return r.status, None
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:  # connection refused, DNS, timeout, TLS
        return None, type(e).__name__


def mcp_config_servers(root: Path) -> dict:
    """Server names mentioned in config files. Configured != callable."""
    found = {}
    for f in (root / ".mcp.json", root / ".claude" / "settings.json", root / ".claude" / "settings.local.json",
              Path.home() / ".claude.json"):
        try:
            data = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        servers = dict(data.get("mcpServers") or {})
        for proj in (data.get("projects") or {}).values():
            servers.update((proj or {}).get("mcpServers") or {})
        for name in servers:
            found.setdefault(name, str(f))
    return found


def detect(observed_tools=None, workflow=None, root: Path | None = None) -> dict:
    root = root or common.repo_root()
    r = {}

    # --- Claude Code tools / MCP ------------------------------------------------------------
    configured = mcp_config_servers(root)
    n8n_cfg = {k: v for k, v in configured.items() if "n8n" in k.lower()}
    if observed_tools is None:
        r["claude_code_tools"] = item(NOT_TESTED, "pass --observed-tools (agent's actual callable tool names)")
        r["mcp_integrations"] = item(NOT_TESTED, "pass --observed-tools", configured=sorted(configured))
        r["n8n_mcp_configured"] = item(AVAILABLE if n8n_cfg else NOT_CONFIGURED,
                                       f"in {sorted(set(n8n_cfg.values()))}" if n8n_cfg else "no n8n server in .mcp.json/settings/~/.claude.json")
        r["n8n_mcp_tools"] = item(NOT_TESTED, "pass --observed-tools")
    else:
        names = [t for t in observed_tools if t]
        servers = sorted({m.group(1) for t in names if (m := re.match(r"mcp__([^_].*?)__", t))})
        n8n_tools = [t for t in names if re.match(r"mcp__[^_]*n8n", t, re.I) or t.lower().startswith("mcp__n8n")]
        r["claude_code_tools"] = item(AVAILABLE if names else UNAVAILABLE, f"{len(names)} tools observed")
        r["mcp_integrations"] = item(AVAILABLE if servers else UNAVAILABLE,
                                     "servers with observed callable tools; callability of each tool not probed",
                                     servers=servers, configured_not_observed=sorted(set(configured) - set(servers)))
        r["n8n_mcp_configured"] = item(AVAILABLE if n8n_cfg else NOT_CONFIGURED,
                                       f"in {sorted(set(n8n_cfg.values()))}" if n8n_cfg else "no n8n server in config files")
        if n8n_tools:
            r["n8n_mcp_tools"] = item(AVAILABLE, f"{len(n8n_tools)} n8n tool(s) observed", tools=sorted(n8n_tools))
        elif n8n_cfg:
            r["n8n_mcp_tools"] = item(BUT_UNUSABLE, "configured but no callable n8n tools observed in this session")
        else:
            r["n8n_mcp_tools"] = item(UNAVAILABLE, "no n8n tools observed; not configured")

    # --- n8n API / reachability ------------------------------------------------------------
    url = (os.environ.get("N8N_API_URL") or os.environ.get("N8N_BASE_URL") or "").rstrip("/")
    key = os.environ.get("N8N_API_KEY")
    probe = url or "http://localhost:5678"
    code, err = _http(probe + "/healthz")
    if code is None:
        r["n8n_reachable"] = item(UNAVAILABLE, f"{probe} -> {err}" + ("" if url else " (default URL probed; N8N_API_URL unset)"))
    elif 200 <= code < 300:
        r["n8n_reachable"] = item(AVAILABLE, f"{probe}/healthz -> {code}")
    else:
        r["n8n_reachable"] = item(BUT_UNUSABLE, f"{probe}/healthz -> HTTP {code}")
    if not url or not key:
        missing = [n for n, v in (("N8N_API_URL", url), ("N8N_API_KEY", key)) if not v]
        r["n8n_api"] = item(NOT_CONFIGURED, f"env not set: {', '.join(missing)}")
    elif code is None:
        r["n8n_api"] = item(UNAVAILABLE, f"configured but {url} unreachable ({err})")
    else:
        c2, e2 = _http(url + "/api/v1/workflows?limit=1", {"X-N8N-API-KEY": key})
        if c2 and 200 <= c2 < 300:
            r["n8n_api"] = item(AVAILABLE, "GET /api/v1/workflows?limit=1 -> %d (read-only probe)" % c2)
        elif c2 in (401, 403):
            r["n8n_api"] = item(BUT_UNUSABLE, f"reachable but credentials rejected (HTTP {c2})")
        else:
            r["n8n_api"] = item(UNAVAILABLE, f"API probe failed: {c2 or e2}")

    # --- Docker / Node / Git ---------------------------------------------------------------
    if not shutil.which("docker"):
        r["docker_cli"] = item(UNAVAILABLE, "docker not on PATH")
        r["docker_daemon"] = item(UNAVAILABLE, "no docker CLI")
    else:
        r["docker_cli"] = item(AVAILABLE, shutil.which("docker"))
        rc, out = _run(["docker", "info", "--format", "{{.ServerVersion}}"])
        r["docker_daemon"] = item(AVAILABLE, f"server {out}") if rc == 0 else item(
            UNAVAILABLE, out.splitlines()[0][:160] if out else f"rc={rc}")
    for tool in ("node", "npx"):
        path = shutil.which(tool)
        if path:
            rc, out = _run([tool, "--version"])
            r[tool] = item(AVAILABLE if rc == 0 else BUT_UNUSABLE, out.splitlines()[0] if out else path)
        else:
            r[tool] = item(UNAVAILABLE, f"{tool} not on PATH")
    rc, out = _run(["git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD"])
    if rc != 0:
        r["git"] = item(UNAVAILABLE, out[:120])
    else:
        _, dirty = _run(["git", "-C", str(root), "status", "--porcelain"])
        r["git"] = item(AVAILABLE, f"HEAD={out}; {'dirty' if dirty else 'clean'}",
                        head=out, dirty=bool(dirty), detached=(out == "HEAD"))

    # --- workflow artifact & level ----------------------------------------------------------
    wf = workflow
    if not wf:
        st = common.read_json(common.home() / "state.json", {}) or {}
        wf = st.get("workflow_path")
    wf_path = (root / wf) if wf and not Path(wf).is_absolute() else (Path(wf) if wf else None)
    if wf_path and wf_path.is_file():
        r["workflow_artifact"] = item(AVAILABLE, str(wf_path))
    else:
        r["workflow_artifact"] = item(NOT_CONFIGURED if not wf else UNAVAILABLE, f"{wf or 'no workflow_path in state'}")

    if r["n8n_mcp_tools"]["status"] == AVAILABLE:
        level = 3
    elif r["n8n_api"]["status"] == AVAILABLE and r["n8n_reachable"]["status"] == AVAILABLE:
        level = 2
    elif r["workflow_artifact"]["status"] == AVAILABLE:
        level = 1
    else:
        level = 0
    meaning = {0: "No n8n runtime: specification, workflow JSON authoring, static validation only",
               1: "Workflow artifact present: JSON inspection, static validation, code-node testing where possible",
               2: "Live n8n API: import, read back, execute, inspect executions",
               3: "n8n MCP tools: use MCP for supported operations, API fallback for the rest"}[level]
    can_runtime = level >= 2
    return {"generated_at": common.now(), "capability_level": level, "level_meaning": meaning,
            "runtime_tests_possible": can_runtime,
            "statuses": r,
            "notes": ["Capability level 2/3 means runtime tests are POSSIBLE, not that they passed.",
                      "Absence of observed tools is evidence only for this session."]}


def render(rep: dict) -> str:
    lines = [f"CAPABILITY LEVEL {rep['capability_level']}: {rep['level_meaning']}",
             f"runtime tests possible: {rep['runtime_tests_possible']}", ""]
    for k, v in rep["statuses"].items():
        lines.append(f"  {k:22} {v['status']:24} {v['detail']}")
    return "\n".join(lines)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--observed-tools", help="comma-separated tool names the agent can actually call")
    p.add_argument("--workflow", help="workflow JSON path (default: state.json workflow_path)")
    p.add_argument("--no-write", action="store_true", help="print only; do not persist the report")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    obs = [t.strip() for t in a.observed_tools.split(",")] if a.observed_tools is not None else None
    rep = detect(obs, a.workflow)
    if not a.no_write:
        common.write_json(common.home() / "reports" / "environment.json", rep)
        st = common.read_json(common.home() / "state.json")
        if st is not None:
            st["capability_level"], st["environment_report"] = rep["capability_level"], rep["generated_at"]
            common.write_json(common.home() / "state.json", st)
    print(json.dumps(rep, indent=2) if a.json else render(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main())
