import pytest
from fastapi.testclient import TestClient

from app import storage
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_ledger():
    if storage.LEDGER_PATH.exists():
        storage.LEDGER_PATH.unlink()
    yield
    if storage.LEDGER_PATH.exists():
        storage.LEDGER_PATH.unlink()


def test_list_employees():
    response = client.get("/employees")
    assert response.status_code == 200
    employees = response.json()
    assert len(employees) == 6
    assert {e["employee_id"] for e in employees} == {"E001", "E002", "E003", "E004", "E005", "E006"}


def test_run_payroll_second_cutoff_withholds_contributions():
    response = client.post(
        "/payroll/run",
        params={"period_start": "2026-08-16", "period_end": "2026-08-31", "timesheet_source": "both"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["cutoff_label"] == "2nd cutoff (16th-end of month)"
    assert len(body["pay_stubs"]) == 6
    assert body["total_gross"] > 0
    assert not body["warnings"]  # everyone has full attendance in this period

    juan = next(s for s in body["pay_stubs"] if s["employee_id"] == "E001")
    assert juan["gross_pay"] == 12_500.0  # 11 days * (25000 / 22 days/month)
    assert juan["net_pay"] < juan["gross_pay"]


def test_run_payroll_first_cutoff_flags_missing_and_unaccounted_timesheets():
    # Run August first so September's YTD-before figures have something to accumulate.
    client.post(
        "/payroll/run",
        params={"period_start": "2026-08-16", "period_end": "2026-08-31", "timesheet_source": "both"},
    )
    response = client.post(
        "/payroll/run",
        params={"period_start": "2026-09-01", "period_end": "2026-09-15", "timesheet_source": "both"},
    )
    assert response.status_code == 200
    body = response.json()

    assert any("E006" in w or "Carmen" in w for w in body["warnings"])

    ana = next(s for s in body["pay_stubs"] if s["employee_id"] == "E004")
    assert any("unaccounted" in w for w in ana["warnings"])

    ytd_gross, ytd_net, ytd_tax = storage.get_ytd_before("E001", 2026, "2026-09-01")
    assert ytd_gross == 12_500.0  # carried over from the August run


def test_unknown_payroll_run_returns_404():
    response = client.get("/payroll/runs/doesnotexist")
    assert response.status_code == 404
