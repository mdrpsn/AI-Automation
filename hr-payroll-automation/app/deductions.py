"""
Philippine statutory deduction calculators: SSS, PhilHealth, Pag-IBIG (HDMF),
and BIR withholding tax on compensation.

These implementations approximate the official 2023-2024 contribution
schedules closely enough for a portfolio/demo payroll run. They are NOT a
substitute for the official SSS/PhilHealth/Pag-IBIG bracket tables or a
licensed accountant's sign-off before running a real payroll -- see the
README for details and how to swap in exact bracket tables.
"""
from __future__ import annotations

from dataclasses import dataclass

from .models import PayFrequency

# ---------------------------------------------------------------------------
# SSS (Social Security System) -- 2023 schedule: 14% of Monthly Salary Credit
# (MSC), split 4.5% employee / 9.5% employer. MSC is the monthly compensation
# clamped to [4,000, 30,000] and rounded down to the nearest 500.
# ---------------------------------------------------------------------------
SSS_MIN_MSC = 4_000
SSS_MAX_MSC = 30_000
SSS_STEP = 500
SSS_EMPLOYEE_RATE = 0.045
SSS_EMPLOYER_RATE = 0.095


def _monthly_salary_credit(monthly_compensation: float) -> float:
    clamped = min(max(monthly_compensation, SSS_MIN_MSC), SSS_MAX_MSC)
    return (clamped // SSS_STEP) * SSS_STEP


def sss_contribution(monthly_compensation: float) -> tuple[float, float]:
    """Return (employee_share, employer_share) for a full month."""
    msc = _monthly_salary_credit(monthly_compensation)
    employee_share = round(msc * SSS_EMPLOYEE_RATE, 2)
    employer_share = round(msc * SSS_EMPLOYER_RATE, 2)
    return employee_share, employer_share


# ---------------------------------------------------------------------------
# PhilHealth -- 2024 rate: 5% of monthly basic salary, split 50/50, salary
# floor 10,000 and ceiling 100,000.
# ---------------------------------------------------------------------------
PHILHEALTH_RATE = 0.05
PHILHEALTH_FLOOR = 10_000
PHILHEALTH_CEILING = 100_000


def philhealth_contribution(monthly_compensation: float) -> tuple[float, float]:
    base = min(max(monthly_compensation, PHILHEALTH_FLOOR), PHILHEALTH_CEILING)
    total = base * PHILHEALTH_RATE
    share = round(total / 2, 2)
    return share, share


# ---------------------------------------------------------------------------
# Pag-IBIG (HDMF) -- employee 2% of the fund salary credit (capped at 10,000),
# employer 2% as well, for compensation above 1,500 (1% below that threshold
# for the employee share; employer stays at 2%).
# ---------------------------------------------------------------------------
PAGIBIG_MFC_CAP = 10_000
PAGIBIG_LOW_THRESHOLD = 1_500
PAGIBIG_EMPLOYEE_RATE_LOW = 0.01
PAGIBIG_EMPLOYEE_RATE_HIGH = 0.02
PAGIBIG_EMPLOYER_RATE = 0.02


def pagibig_contribution(monthly_compensation: float) -> tuple[float, float]:
    fund_salary_credit = min(monthly_compensation, PAGIBIG_MFC_CAP)
    employee_rate = (
        PAGIBIG_EMPLOYEE_RATE_LOW
        if monthly_compensation <= PAGIBIG_LOW_THRESHOLD
        else PAGIBIG_EMPLOYEE_RATE_HIGH
    )
    employee_share = round(fund_salary_credit * employee_rate, 2)
    employer_share = round(fund_salary_credit * PAGIBIG_EMPLOYER_RATE, 2)
    return employee_share, employer_share


# ---------------------------------------------------------------------------
# BIR withholding tax on compensation -- TRAIN law, 2023 revised annual
# table. Per-period tables (monthly / semi-monthly) are derived by dividing
# the annual thresholds and base tax by the number of pay periods per year,
# which is exactly how the BIR's own monthly/semi-monthly/weekly/daily
# columns are generated from the annual table.
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class TaxBracket:
    annual_floor: float
    annual_base_tax: float
    rate: float


ANNUAL_TAX_TABLE: list[TaxBracket] = [
    TaxBracket(0, 0, 0.00),
    TaxBracket(250_000, 0, 0.15),
    TaxBracket(400_000, 22_500, 0.20),
    TaxBracket(800_000, 102_500, 0.25),
    TaxBracket(2_000_000, 402_500, 0.30),
    TaxBracket(8_000_000, 2_202_500, 0.35),
]

_PERIODS_PER_YEAR = {
    PayFrequency.MONTHLY: 12,
    PayFrequency.SEMI_MONTHLY: 24,
}


def withholding_tax(taxable_income_this_period: float, frequency: PayFrequency) -> float:
    """Compute BIR withholding tax for one pay period's taxable income.

    taxable_income_this_period = gross pay for the period minus SSS,
    PhilHealth and Pag-IBIG withheld in that same period.
    """
    periods = _PERIODS_PER_YEAR[frequency]
    bracket = ANNUAL_TAX_TABLE[0]
    for candidate in ANNUAL_TAX_TABLE:
        period_floor = candidate.annual_floor / periods
        if taxable_income_this_period >= period_floor:
            bracket = candidate
        else:
            break
    period_floor = bracket.annual_floor / periods
    period_base_tax = bracket.annual_base_tax / periods
    excess = max(0.0, taxable_income_this_period - period_floor)
    return round(period_base_tax + excess * bracket.rate, 2)
