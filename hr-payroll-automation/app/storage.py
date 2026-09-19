"""Employee CSV loading and a JSON-file ledger used to track YTD totals
across payroll runs. No database -- this is a small-business-scale tool
where the ledger file itself is the audit trail.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

from .models import Employee, PayFrequency, PayrollRun, PayType

LEDGER_PATH = Path(__file__).resolve().parent.parent / "output" / "payroll_ledger.json"


def load_employees(path: str | Path) -> list[Employee]:
    employees = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            employees.append(
                Employee(
                    employee_id=row["employee_id"].strip(),
                    first_name=row["first_name"].strip(),
                    last_name=row["last_name"].strip(),
                    email=row["email"].strip(),
                    position=row["position"].strip(),
                    pay_type=PayType(row["pay_type"].strip().lower()),
                    rate=float(row["rate"]),
                    pay_frequency=PayFrequency(row.get("pay_frequency", "semi-monthly").strip().lower()),
                )
            )
    return employees


def _load_ledger() -> list[dict]:
    if not LEDGER_PATH.exists():
        return []
    return json.loads(LEDGER_PATH.read_text(encoding="utf-8"))


def get_ytd_before(employee_id: str, year: int, before_date: str) -> tuple[float, float, float]:
    """Sum gross/net/tax from prior runs this year, strictly before before_date (ISO)."""
    ledger = _load_ledger()
    gross = net = tax = 0.0
    for run in ledger:
        if run["period_start"][:4] != str(year):
            continue
        if run["period_start"] >= before_date:
            continue
        for stub in run["pay_stubs"]:
            if stub["employee_id"] == employee_id:
                gross += stub["gross_pay"]
                net += stub["net_pay"]
                tax += stub["withholding_tax"]
    return round(gross, 2), round(net, 2), round(tax, 2)


def save_run(run: PayrollRun) -> None:
    ledger = _load_ledger()
    ledger.append(
        {
            "run_id": run.run_id,
            "period_start": run.period_start.isoformat(),
            "period_end": run.period_end.isoformat(),
            "cutoff_label": run.cutoff_label,
            "warnings": run.warnings,
            "pay_stubs": [
                {
                    "employee_id": stub.employee.employee_id,
                    "employee_name": stub.employee.full_name,
                    "gross_pay": stub.gross_pay,
                    "net_pay": stub.net_pay,
                    "withholding_tax": stub.deductions.withholding_tax,
                }
                for stub in run.pay_stubs
            ],
        }
    )
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    LEDGER_PATH.write_text(json.dumps(ledger, indent=2), encoding="utf-8")


def list_runs() -> list[dict]:
    return _load_ledger()
