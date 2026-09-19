"""Data models for the payroll engine."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum


class PayType(str, Enum):
    MONTHLY = "monthly"
    DAILY = "daily"


class PayFrequency(str, Enum):
    MONTHLY = "monthly"
    SEMI_MONTHLY = "semi-monthly"


@dataclass
class Employee:
    employee_id: str
    first_name: str
    last_name: str
    email: str
    position: str
    pay_type: PayType
    rate: float  # monthly salary if pay_type == MONTHLY, else daily rate
    pay_frequency: PayFrequency = PayFrequency.SEMI_MONTHLY

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

    @property
    def daily_rate(self) -> float:
        if self.pay_type == PayType.DAILY:
            return self.rate
        # 22 working days/month is the common Philippine payroll divisor
        return self.rate / 22

    @property
    def hourly_rate(self) -> float:
        return self.daily_rate / 8

    @property
    def monthly_basic_salary(self) -> float:
        if self.pay_type == PayType.MONTHLY:
            return self.rate
        return self.daily_rate * 22


@dataclass
class TimeLogEntry:
    """One employee's normalized attendance for a single calendar day."""
    employee_id: str
    log_date: date
    hours_worked: float
    late_minutes: int = 0
    is_absent: bool = False
    source: str = ""  # "hr.my" or "dtr"


@dataclass
class DailyAggregate:
    days_present: int = 0
    days_absent: int = 0
    regular_hours: float = 0.0
    overtime_hours: float = 0.0
    late_minutes: int = 0


@dataclass
class DeductionBreakdown:
    sss_employee: float = 0.0
    sss_employer: float = 0.0
    philhealth_employee: float = 0.0
    philhealth_employer: float = 0.0
    pagibig_employee: float = 0.0
    pagibig_employer: float = 0.0
    withholding_tax: float = 0.0
    late_undertime_deduction: float = 0.0
    absence_deduction: float = 0.0

    @property
    def total_employee_deductions(self) -> float:
        return (
            self.sss_employee
            + self.philhealth_employee
            + self.pagibig_employee
            + self.withholding_tax
            + self.late_undertime_deduction
            + self.absence_deduction
        )


@dataclass
class PayStub:
    employee: Employee
    period_start: date
    period_end: date
    cutoff_label: str  # "1st cutoff (1-15)" / "2nd cutoff (16-end)" / "monthly"
    regular_hours: float
    overtime_hours: float
    days_present: int
    days_absent: int
    late_minutes: int
    gross_pay: float
    deductions: DeductionBreakdown
    net_pay: float
    ytd_gross_before: float = 0.0
    ytd_net_before: float = 0.0
    ytd_tax_before: float = 0.0
    warnings: list[str] = field(default_factory=list)

    @property
    def ytd_gross_after(self) -> float:
        return self.ytd_gross_before + self.gross_pay

    @property
    def ytd_net_after(self) -> float:
        return self.ytd_net_before + self.net_pay

    @property
    def ytd_tax_after(self) -> float:
        return self.ytd_tax_before + self.deductions.withholding_tax


@dataclass
class PayrollRun:
    run_id: str
    period_start: date
    period_end: date
    cutoff_label: str
    pay_stubs: list[PayStub]
    warnings: list[str] = field(default_factory=list)

    @property
    def total_gross(self) -> float:
        return sum(p.gross_pay for p in self.pay_stubs)

    @property
    def total_net(self) -> float:
        return sum(p.net_pay for p in self.pay_stubs)

    @property
    def total_withholding_tax(self) -> float:
        return sum(p.deductions.withholding_tax for p in self.pay_stubs)
