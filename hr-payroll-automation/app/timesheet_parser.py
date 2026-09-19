"""
Parsers that normalize two real-world timesheet sources into a common
TimeLogEntry format:

1. hr.my's clocking report export -- columns:
   Employee ID, Employee Name, Date, Clock In, Clock Out, Total Hours

2. Manually transcribed paper DTR (Daily Time Record) sheets -- columns:
   Employee ID, Date, AM Time In, AM Time Out, PM Time In, PM Time Out

Both formats are reduced to hours worked + lateness against a standard
08:00-17:00 shift (1-hour unpaid lunch, 8 paid hours/day) with a 10-minute
grace period. Adjust STANDARD_SHIFT_START / GRACE_PERIOD_MINUTES if your
business uses a different schedule.
"""
from __future__ import annotations

import csv
from datetime import date, datetime, time
from pathlib import Path

from .models import TimeLogEntry

STANDARD_SHIFT_START = time(8, 0)
GRACE_PERIOD_MINUTES = 10
STANDARD_PAID_HOURS = 8.0


def _parse_date(value: str) -> date:
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognized date format: {value!r}")


def _parse_time(value: str) -> time | None:
    value = value.strip()
    if not value:
        return None
    for fmt in ("%H:%M", "%I:%M %p", "%I:%M%p"):
        try:
            return datetime.strptime(value, fmt).time()
        except ValueError:
            continue
    raise ValueError(f"Unrecognized time format: {value!r}")


def _late_minutes(first_clock_in: time | None) -> int:
    if first_clock_in is None:
        return 0
    shift_start_minutes = STANDARD_SHIFT_START.hour * 60 + STANDARD_SHIFT_START.minute
    clock_in_minutes = first_clock_in.hour * 60 + first_clock_in.minute
    late = clock_in_minutes - shift_start_minutes - GRACE_PERIOD_MINUTES
    return max(0, late)


def parse_hrmy_csv(path: str | Path) -> list[TimeLogEntry]:
    """Parse an hr.my clocking report export.

    Expected columns: Employee ID, Employee Name, Date, Clock In, Clock Out,
    Total Hours. "Total Hours" is trusted as-is (hr.my already nets out
    breaks); lateness is derived from Clock In vs. the standard shift start.
    """
    entries: list[TimeLogEntry] = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            employee_id = row["Employee ID"].strip()
            log_date = _parse_date(row["Date"])
            clock_in = _parse_time(row.get("Clock In", ""))
            hours = float(row["Total Hours"]) if row.get("Total Hours") else 0.0
            entries.append(
                TimeLogEntry(
                    employee_id=employee_id,
                    log_date=log_date,
                    hours_worked=hours,
                    late_minutes=_late_minutes(clock_in),
                    is_absent=hours <= 0,
                    source="hr.my",
                )
            )
    return entries


def parse_dtr_csv(path: str | Path) -> list[TimeLogEntry]:
    """Parse a manually transcribed paper DTR sheet.

    Expected columns: Employee ID, Date, AM Time In, AM Time Out,
    PM Time In, PM Time Out. Hours worked = AM span + PM span. A row with
    all four time fields blank is treated as an absence.
    """
    entries: list[TimeLogEntry] = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            employee_id = row["Employee ID"].strip()
            log_date = _parse_date(row["Date"])
            am_in = _parse_time(row.get("AM Time In", ""))
            am_out = _parse_time(row.get("AM Time Out", ""))
            pm_in = _parse_time(row.get("PM Time In", ""))
            pm_out = _parse_time(row.get("PM Time Out", ""))

            if not any([am_in, am_out, pm_in, pm_out]):
                entries.append(
                    TimeLogEntry(
                        employee_id=employee_id,
                        log_date=log_date,
                        hours_worked=0.0,
                        is_absent=True,
                        source="dtr",
                    )
                )
                continue

            hours = 0.0
            if am_in and am_out:
                hours += (
                    datetime.combine(log_date, am_out) - datetime.combine(log_date, am_in)
                ).total_seconds() / 3600
            if pm_in and pm_out:
                hours += (
                    datetime.combine(log_date, pm_out) - datetime.combine(log_date, pm_in)
                ).total_seconds() / 3600

            entries.append(
                TimeLogEntry(
                    employee_id=employee_id,
                    log_date=log_date,
                    hours_worked=round(hours, 2),
                    late_minutes=_late_minutes(am_in),
                    is_absent=hours <= 0,
                    source="dtr",
                )
            )
    return entries


PARSERS = {
    "hrmy": parse_hrmy_csv,
    "dtr": parse_dtr_csv,
}


def parse_timesheet(path: str | Path, source: str) -> list[TimeLogEntry]:
    if source not in PARSERS:
        raise ValueError(f"Unknown timesheet source {source!r}; expected one of {list(PARSERS)}")
    return PARSERS[source](path)
