from pathlib import Path

from app.timesheet_parser import parse_dtr_csv, parse_hrmy_csv

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def test_parse_hrmy_csv_reads_hours_and_flags_lateness():
    entries = parse_hrmy_csv(DATA_DIR / "timesheets_hrmy_export.csv")
    juan_entries = [e for e in entries if e.employee_id == "E001"]
    assert len(juan_entries) == 22  # 11 days x 2 pay periods

    late_day = next(e for e in juan_entries if e.log_date.isoformat() == "2026-09-01")
    assert late_day.hours_worked == 7.75
    assert late_day.late_minutes == 10  # clocked in 08:20, grace period ends 08:10

    on_time_day = next(e for e in juan_entries if e.log_date.isoformat() == "2026-09-02")
    assert on_time_day.late_minutes == 0


def test_parse_dtr_csv_computes_hours_from_am_pm_spans():
    entries = parse_dtr_csv(DATA_DIR / "timesheets_dtr_manual.csv")
    pedro_entries = [e for e in entries if e.employee_id == "E003"]

    absent_day = next(e for e in pedro_entries if e.log_date.isoformat() == "2026-09-08")
    assert absent_day.is_absent
    assert absent_day.hours_worked == 0.0

    normal_day = next(e for e in pedro_entries if e.log_date.isoformat() == "2026-09-01")
    assert normal_day.hours_worked == 8.0
    assert not normal_day.is_absent


def test_parse_dtr_csv_handles_half_day_with_missing_pm_out():
    entries = parse_dtr_csv(DATA_DIR / "timesheets_dtr_manual.csv")
    half_day = next(
        e for e in entries if e.employee_id == "E005" and e.log_date.isoformat() == "2026-09-09"
    )
    assert half_day.hours_worked == 4.0
    assert not half_day.is_absent
