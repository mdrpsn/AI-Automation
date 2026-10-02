"""Shared helpers for the automation harness tools (stdlib only)."""
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def home() -> Path:
    """Harness data directory. AUTOMATION_HOME overrides it (used by self-tests)."""
    return Path(os.environ.get("AUTOMATION_HOME") or REPO_ROOT / "automation")


def repo_root() -> Path:
    """Directory that workflow_path values are relative to."""
    return Path(os.environ.get("AUTOMATION_REPO_ROOT") or REPO_ROOT)


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default


def write_json(path: Path, data) -> None:
    """Atomic write so an interrupted run never leaves a half-written state file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    with os.fdopen(fd, "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, path)
