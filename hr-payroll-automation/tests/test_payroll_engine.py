from datetime import date

from app.models import DailyAggregate, Employee, PayFrequency, PayType
from app.payroll_engine import compute_pay_stub, cutoff_label, expected_working_days


def test_expected_working_days_counts_weekdays_only():
    # Sept 1-15, 2026: 11 weekdays (excludes the two weekends in range)
    assert expected_working_days(date(2026, 9, 1), date(2026, 9, 15)) == 11


def test_cutoff_label_recognizes_standard_semi_monthly_periods():
    assert cutoff_label(date(2026, 9, 1), date(2026, 9, 15)) == "1st cutoff (1st-15th)"
    assert cutoff_label(date(2026, 8, 16), date(2026, 8, 31)) == "2nd cutoff (16th-end of month)"


def _daily_employee(rate=800.0, frequency=PayFrequency.SEMI_MONTHLY) -> Employee:
    return Employee(
        employee_id="E999",
        first_name="Test",
        last_name="Employee",
        email="test@example.com",
        position="Tester",
        pay_type=PayType.DAILY,
        rate=rate,
        pay_frequency=frequency,
    )


def test_first_cutoff_does_not_withhold_statutory_contributions():
    employee = _daily_employee()
    aggregate = DailyAggregate(days_present=11, regular_hours=88, overtime_hours=0, late_minutes=0)
    stub = compute_pay_stub(employee, aggregate, date(2026, 9, 1), date(2026, 9, 15))

    assert stub.gross_pay == 8_800.0  # 88 hours * P100/hr
    assert stub.deductions.sss_employee == 0.0
    assert stub.deductions.philhealth_employee == 0.0
    assert stub.deductions.pagibig_employee == 0.0
    assert stub.net_pay == 8_800.0  # taxable income falls below the first tax bracket


def test_second_cutoff_withholds_statutory_contributions():
    employee = _daily_employee()
    aggregate = DailyAggregate(days_present=11, regular_hours=88, overtime_hours=0, late_minutes=0)
    stub = compute_pay_stub(employee, aggregate, date(2026, 8, 16), date(2026, 8, 31))

    # monthly_basic_salary = 800 * 22 = 17,600 -> MSC floors to 17,500
    assert stub.deductions.sss_employee == 787.5
    assert stub.deductions.philhealth_employee == 440.0
    assert stub.deductions.pagibig_employee == 200.0
    assert stub.net_pay == round(
        stub.gross_pay
        - stub.deductions.sss_employee
        - stub.deductions.philhealth_employee
        - stub.deductions.pagibig_employee
        - stub.deductions.withholding_tax,
        2,
    )


def test_overtime_is_paid_at_1_25x():
    employee = _daily_employee()
    aggregate = DailyAggregate(days_present=11, regular_hours=80, overtime_hours=8, late_minutes=0)
    stub = compute_pay_stub(employee, aggregate, date(2026, 9, 1), date(2026, 9, 15))
    assert stub.gross_pay == 80 * 100 + 8 * 100 * 1.25


def test_absences_are_deducted_at_the_daily_rate():
    employee = _daily_employee()
    aggregate = DailyAggregate(days_present=10, days_absent=1, regular_hours=80, overtime_hours=0, late_minutes=0)
    stub = compute_pay_stub(employee, aggregate, date(2026, 9, 1), date(2026, 9, 15))
    assert stub.deductions.absence_deduction == employee.daily_rate


def test_late_minutes_are_deducted_per_minute_at_hourly_rate():
    employee = _daily_employee()
    aggregate = DailyAggregate(days_present=11, regular_hours=88, overtime_hours=0, late_minutes=30)
    stub = compute_pay_stub(employee, aggregate, date(2026, 9, 1), date(2026, 9, 15))
    assert stub.deductions.late_undertime_deduction == round((30 / 60) * employee.hourly_rate, 2)
