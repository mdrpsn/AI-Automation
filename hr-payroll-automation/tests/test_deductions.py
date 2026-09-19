from app.deductions import (
    pagibig_contribution,
    philhealth_contribution,
    sss_contribution,
    withholding_tax,
)
from app.models import PayFrequency


def test_sss_contribution_within_range():
    employee, employer = sss_contribution(25_000)
    assert employee == 1_125.0
    assert employer == 2_375.0


def test_sss_contribution_below_floor_clamps_to_minimum_msc():
    employee, employer = sss_contribution(3_000)
    assert employee == 180.0  # MSC clamped to 4,000
    assert employer == 380.0


def test_sss_contribution_above_ceiling_clamps_to_maximum_msc():
    employee, employer = sss_contribution(50_000)
    assert employee == 1_350.0  # MSC clamped to 30,000
    assert employer == 2_850.0


def test_sss_contribution_rounds_msc_down_to_nearest_step():
    employee, employer = sss_contribution(22_750)  # MSC floors to 22,500
    assert employee == 1_012.5
    assert employer == 2_137.5


def test_philhealth_contribution_split_evenly():
    employee, employer = philhealth_contribution(25_000)
    assert employee == employer == 625.0


def test_philhealth_contribution_below_floor_clamps():
    employee, employer = philhealth_contribution(5_000)
    assert employee == employer == 250.0  # floor of 10,000 * 5% / 2


def test_philhealth_contribution_above_ceiling_clamps():
    employee, employer = philhealth_contribution(150_000)
    assert employee == employer == 2_500.0  # ceiling of 100,000 * 5% / 2


def test_pagibig_contribution_standard_rate():
    employee, employer = pagibig_contribution(25_000)
    assert employee == 200.0  # 2% of the 10,000 fund salary credit cap
    assert employer == 200.0


def test_pagibig_contribution_low_income_rate():
    employee, employer = pagibig_contribution(1_000)
    assert employee == 10.0  # 1% rate below the 1,500 threshold
    assert employer == 20.0  # employer stays at 2%


def test_withholding_tax_at_or_below_zero_bracket_floor_is_zero():
    assert withholding_tax(15_000, PayFrequency.MONTHLY) == 0.0


def test_withholding_tax_known_monthly_example():
    # A well-known reference point for the 2023 TRAIN withholding table:
    # P25,000 monthly taxable compensation withholds P625.
    assert withholding_tax(25_000, PayFrequency.MONTHLY) == 625.0


def test_withholding_tax_semi_monthly_matches_scaled_annual_table():
    tax = withholding_tax(12_500, PayFrequency.SEMI_MONTHLY)
    assert tax == 312.5
