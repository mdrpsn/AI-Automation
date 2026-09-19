"""Core payroll computation: turns timesheet entries into pay stubs.

Business rules encoded here (typical Philippine SME practice):
- Overtime is any daily hours beyond 8, paid at 1.25x the hourly rate.
- Late/undertime is deducted per minute at hourly_rate / 60.
- Absences (on days the employee was expected to work) are deducted at the
  daily rate for daily-rate employees, or the equivalent daily rate for
  monthly-rate employees.
- SSS / PhilHealth / Pag-IBIG are withheld once per month, on the 2nd
  semi-monthly cutoff (16th-end of month) -- the 1st cutoff (1st-15th) only
  withholds tax on that period's taxable pay. Employees paid on a straight
  monthly frequency have contributions withheld every run.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, timedelta

from .deductions import pagibig_contribution, philhealth_contribution, sss_contribution, withholding_tax
from .models import (
    DailyAggregate,
    DeductionBreakdown,
    Employee,
    PayFrequency,
    PayrollRun,
    PayStub,
    PayType,
    TimeLogEntry,
)


def expected_working_days(period_start: date, period_end: date) -> int:
    """Weekdays (Mon-Fri) in the inclusive range. No holiday calendar."""
    days = 0
    current = period_start
    while current <= period_end:
        if current.weekday() < 5:
            days += 1
        current += timedelta(days=1)
    return days


def cutoff_label(period_start: date, period_end: date) -> str:
    if period_start.day == 1 and period_end.day == 15:
        return "1st cutoff (1st-15th)"
    if period_start.day == 16:
        return "2nd cutoff (16th-end of month)"
    return f"{period_start.isoformat()} to {period_end.isoformat()}"


def _withholds_statutory_contributions(period_start: date, frequency: PayFrequency) -> bool:
    if frequency == PayFrequency.MONTHLY:
        return True
    return period_start.day == 16


def aggregate_timesheet(
    entries: list[TimeLogEntry], period_start: date, period_end: date
) -> dict[str, DailyAggregate]:
    aggregates: dict[str, DailyAggregate] = defaultdict(DailyAggregate)
    for entry in entries:
        if not (period_start <= entry.log_date <= period_end):
            continue
        agg = aggregates[entry.employee_id]
        if entry.is_absent or entry.hours_worked <= 0:
            agg.days_absent += 1
            continue
        agg.days_present += 1
        agg.regular_hours += min(entry.hours_worked, 8.0)
        agg.overtime_hours += max(0.0, entry.hours_worked - 8.0)
        agg.late_minutes += entry.late_minutes
    return dict(aggregates)


def compute_pay_stub(
    employee: Employee,
    aggregate: DailyAggregate,
    period_start: date,
    period_end: date,
    ytd_gross_before: float = 0.0,
    ytd_net_before: float = 0.0,
    ytd_tax_before: float = 0.0,
) -> PayStub:
    warnings: list[str] = []
    label = cutoff_label(period_start, period_end)

    expected_days = expected_working_days(period_start, period_end)
    unaccounted_days = max(0, expected_days - aggregate.days_present - aggregate.days_absent)
    total_absent_days = aggregate.days_absent + unaccounted_days
    if unaccounted_days:
        warnings.append(
            f"{unaccounted_days} unaccounted expected working day(s) have no timesheet entry "
            "and were treated as absences."
        )

    hourly_rate = employee.hourly_rate
    regular_pay = aggregate.regular_hours * hourly_rate
    overtime_pay = aggregate.overtime_hours * hourly_rate * 1.25
    late_deduction = round((aggregate.late_minutes / 60) * hourly_rate, 2)
    absence_deduction = round(total_absent_days * employee.daily_rate, 2)

    gross_pay = round(regular_pay + overtime_pay, 2)

    withhold_contributions = _withholds_statutory_contributions(period_start, employee.pay_frequency)
    deductions = DeductionBreakdown(
        late_undertime_deduction=late_deduction,
        absence_deduction=absence_deduction,
    )

    if withhold_contributions:
        deductions.sss_employee, deductions.sss_employer = sss_contribution(employee.monthly_basic_salary)
        deductions.philhealth_employee, deductions.philhealth_employer = philhealth_contribution(
            employee.monthly_basic_salary
        )
        deductions.pagibig_employee, deductions.pagibig_employer = pagibig_contribution(
            employee.monthly_basic_salary
        )

    taxable_income = max(
        0.0,
        gross_pay
        - late_deduction
        - absence_deduction
        - deductions.sss_employee
        - deductions.philhealth_employee
        - deductions.pagibig_employee,
    )
    deductions.withholding_tax = withholding_tax(taxable_income, employee.pay_frequency)

    net_pay = round(gross_pay - deductions.total_employee_deductions, 2)
    if net_pay < 0:
        warnings.append("Net pay is negative -- deductions exceed gross pay for this period.")

    return PayStub(
        employee=employee,
        period_start=period_start,
        period_end=period_end,
        cutoff_label=label,
        regular_hours=round(aggregate.regular_hours, 2),
        overtime_hours=round(aggregate.overtime_hours, 2),
        days_present=aggregate.days_present,
        days_absent=total_absent_days,
        late_minutes=aggregate.late_minutes,
        gross_pay=gross_pay,
        deductions=deductions,
        net_pay=net_pay,
        ytd_gross_before=ytd_gross_before,
        ytd_net_before=ytd_net_before,
        ytd_tax_before=ytd_tax_before,
        warnings=warnings,
    )


def run_payroll(
    employees: list[Employee],
    entries: list[TimeLogEntry],
    period_start: date,
    period_end: date,
    ytd_lookup: dict[str, tuple[float, float, float]] | None = None,
) -> PayrollRun:
    """ytd_lookup maps employee_id -> (ytd_gross_before, ytd_net_before, ytd_tax_before)."""
    ytd_lookup = ytd_lookup or {}
    aggregates = aggregate_timesheet(entries, period_start, period_end)
    run_warnings: list[str] = []
    pay_stubs: list[PayStub] = []

    for employee in employees:
        aggregate = aggregates.get(employee.employee_id)
        if aggregate is None:
            run_warnings.append(
                f"No timesheet entries found for {employee.full_name} ({employee.employee_id}) "
                "in this period -- treated as fully absent."
            )
            aggregate = DailyAggregate(days_absent=expected_working_days(period_start, period_end))
        ytd_gross, ytd_net, ytd_tax = ytd_lookup.get(employee.employee_id, (0.0, 0.0, 0.0))
        pay_stubs.append(
            compute_pay_stub(
                employee,
                aggregate,
                period_start,
                period_end,
                ytd_gross_before=ytd_gross,
                ytd_net_before=ytd_net,
                ytd_tax_before=ytd_tax,
            )
        )

    return PayrollRun(
        run_id=str(uuid.uuid4())[:8],
        period_start=period_start,
        period_end=period_end,
        cutoff_label=cutoff_label(period_start, period_end),
        pay_stubs=pay_stubs,
        warnings=run_warnings,
    )
