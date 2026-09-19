"""FastAPI service for the HR payroll automation build.

Ingests attendance from two real-world sources a small business actually
has -- an hr.my time-clock export and manually transcribed paper DTR sheets
-- and computes a Philippines-compliant payroll run (SSS/PhilHealth/
Pag-IBIG/BIR withholding).
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException

from . import storage
from .models import Employee, TimeLogEntry
from .payroll_engine import run_payroll
from .timesheet_parser import parse_dtr_csv, parse_hrmy_csv

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

EMPLOYEES_CSV = DATA_DIR / "employees.csv"
HRMY_CSV = DATA_DIR / "timesheets_hrmy_export.csv"
DTR_CSV = DATA_DIR / "timesheets_dtr_manual.csv"

app = FastAPI(title="HR Payroll Automation", version="1.0.0")


def _load_all_entries(source: Literal["hrmy", "dtr", "both"]) -> list[TimeLogEntry]:
    entries: list[TimeLogEntry] = []
    if source in ("hrmy", "both") and HRMY_CSV.exists():
        entries += parse_hrmy_csv(HRMY_CSV)
    if source in ("dtr", "both") and DTR_CSV.exists():
        entries += parse_dtr_csv(DTR_CSV)
    return entries


def _employees_by_id(employees: list[Employee]) -> dict[str, Employee]:
    return {e.employee_id: e for e in employees}


@app.get("/employees")
def list_employees():
    employees = storage.load_employees(EMPLOYEES_CSV)
    return [
        {
            "employee_id": e.employee_id,
            "name": e.full_name,
            "position": e.position,
            "pay_type": e.pay_type.value,
            "rate": e.rate,
            "pay_frequency": e.pay_frequency.value,
        }
        for e in employees
    ]


@app.post("/payroll/run")
def create_payroll_run(
    period_start: date,
    period_end: date,
    timesheet_source: Literal["hrmy", "dtr", "both"] = "both",
):
    if period_end < period_start:
        raise HTTPException(400, "period_end must be on or after period_start")

    employees = storage.load_employees(EMPLOYEES_CSV)
    if not employees:
        raise HTTPException(400, "No employees found in data/employees.csv")

    entries = _load_all_entries(timesheet_source)

    ytd_lookup = {
        e.employee_id: storage.get_ytd_before(e.employee_id, period_start.year, period_start.isoformat())
        for e in employees
    }

    run = run_payroll(employees, entries, period_start, period_end, ytd_lookup)
    storage.save_run(run)

    return {
        "run_id": run.run_id,
        "period_start": run.period_start.isoformat(),
        "period_end": run.period_end.isoformat(),
        "cutoff_label": run.cutoff_label,
        "total_gross": run.total_gross,
        "total_net": run.total_net,
        "total_withholding_tax": run.total_withholding_tax,
        "warnings": run.warnings,
        "pay_stubs": [
            {
                "employee_id": stub.employee.employee_id,
                "employee_name": stub.employee.full_name,
                "gross_pay": stub.gross_pay,
                "net_pay": stub.net_pay,
                "withholding_tax": stub.deductions.withholding_tax,
                "warnings": stub.warnings,
            }
            for stub in run.pay_stubs
        ],
    }


@app.get("/payroll/runs")
def list_payroll_runs():
    return storage.list_runs()


@app.get("/payroll/runs/{run_id}")
def get_payroll_run(run_id: str):
    for run in storage.list_runs():
        if run["run_id"] == run_id:
            return run
    raise HTTPException(404, f"Payroll run {run_id!r} not found")
