# HR Payroll Automation

A standalone payroll engine and API for a small Philippine business that still
runs attendance on paper DTR sheets and an hr.my time clock, and computes pay
by hand in a spreadsheet twice a month.

## The problem

Payroll for a small business with a handful of daily-rate and monthly-rate
staff is deceptively hard to get right by hand: hours have to be pulled from
two different sources (a time-clock export and handwritten DTR sheets),
overtime and lateness have to be calculated per employee, and four separate
statutory deductions (SSS, PhilHealth, Pag-IBIG, BIR withholding tax) each
have their own bracket rules that change depending on the pay period. A
spreadsheet formula that's slightly wrong doesn't announce itself — it just
quietly under- or over-pays someone every cutoff.

## What it does

A FastAPI service that:

1. **Ingests attendance from two real sources** — an hr.my clocking report
   export and manually transcribed paper DTR sheets — and normalizes both
   into the same hours-worked/lateness/absence model.
2. **Runs a full semi-monthly payroll**: regular hours, overtime (1.25x past
   8 hours/day), late/undertime deductions, and absence deductions, all
   applied per employee's actual pay type (monthly or daily rate).
3. **Computes Philippine statutory deductions** — SSS, PhilHealth, Pag-IBIG,
   and BIR withholding tax — following the real semi-monthly cutoff practice
   most PH small businesses use: contributions are withheld once, on the
   16th–end-of-month cutoff, while the 1st–15th cutoff only withholds tax.
4. **Tracks year-to-date totals** per employee via a JSON ledger, so every
   run knows each employee's cumulative gross pay, net pay, and tax withheld.
5. **Flags problems instead of silently guessing** — a missing timesheet for
   an expected working day, an employee with zero attendance for the whole
   period, or a period where deductions exceed gross pay all surface as
   explicit warnings on the run and on that employee's pay stub record.

## Architecture

```
app/
  models.py            Employee, TimeLogEntry, PayStub, PayrollRun dataclasses
  deductions.py         SSS / PhilHealth / Pag-IBIG / BIR withholding tax
  timesheet_parser.py   hr.my CSV + manual DTR CSV -> normalized TimeLogEntry
  payroll_engine.py     timesheet aggregation -> gross/net pay per employee
  storage.py            employee CSV loading + JSON ledger for YTD totals
  main.py                FastAPI endpoints
data/                   sample employees + both timesheet formats
tests/                  unit tests (deductions, engine, parser) + API test
```

No database — a JSON ledger file (`output/payroll_ledger.json`) written after
every run is the audit trail used to compute year-to-date totals, which is
proportionate for a business this size and keeps the whole thing runnable
from a laptop with no infrastructure.

## API

| Endpoint | Description |
|---|---|
| `GET /employees` | List employees loaded from `data/employees.csv` |
| `POST /payroll/run?period_start=&period_end=&timesheet_source=hrmy\|dtr\|both` | Run payroll for a period and save it to the ledger |
| `GET /payroll/runs` | List all past runs |
| `GET /payroll/runs/{run_id}` | Get one run's summary |

## Running it

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Then, for example:

```bash
curl -X POST "http://127.0.0.1:8000/payroll/run?period_start=2026-08-16&period_end=2026-08-31&timesheet_source=both"
```

## Sample data

`data/employees.csv` has 6 employees — a mix of monthly and daily rate, some
tracked via the hr.my time clock (`data/timesheets_hrmy_export.csv`) and some
via manually transcribed DTR sheets (`data/timesheets_dtr_manual.csv`) — since
that's the real mix at most small businesses still transitioning off paper.
The sample data deliberately includes a late arrival, an overtime day, a
half-day (missing PM time-out on a DTR sheet), an absence, a missing
timesheet row entirely, and one employee with zero attendance for a full
cutoff, so the anomaly-flagging paths are actually exercised, not just the
happy path.

## Tested, not just built

Ran end to end against a real running `uvicorn` server, not just the test
suite:

- Ran payroll for the 2nd cutoff (Aug 16–31, full attendance): 6 pay stub
  records computed, correct SSS/PhilHealth/Pag-IBIG withheld for every
  employee, zero warnings.
- Ran payroll for the 1st cutoff (Sep 1–15, deliberately messy attendance):
  correctly flagged the employee with no timesheet entries at all, correctly
  flagged the one unaccounted (missing-row) working day for another
  employee, and correctly caught a negative-net-pay case where absence
  deductions exceeded gross pay.
- Confirmed year-to-date totals correctly carried over from the August run
  into September's `ytd_*_before` figures via the JSON ledger.
- Unit/integration tests cover the deduction formulas against known
  reference values (e.g. the commonly-cited P25,000/month → P625 withholding
  tax figure under the 2023 TRAIN table), the payroll engine's
  overtime/late/absence math, both timesheet parsers, and the API end to end.

## Known limitations

- **The SSS, PhilHealth, and Pag-IBIG tables are simplified approximations**
  of the real 2023–2024 schedules (formula-based on Monthly Salary Credit /
  salary brackets), not the exact official bracket tables. Good enough to
  demo correct payroll *mechanics*, not a substitute for the exact tables or
  an accountant's sign-off before running a real payroll.
- No holiday calendar — "expected working days" is just Mon–Fri. A real
  deployment would need PH regular/special holiday rules (which change pay
  rates, not just day counts).
- Every employee is currently paid the same standard 08:00–17:00 shift for
  lateness purposes; per-employee schedules aren't modeled.
- Statutory contributions are computed on `pay_frequency`, not per-employee
  overrides — fine for a business where everyone's on the same semi-monthly
  cutoff, would need extending for mixed pay calendars.
- No pay stub document (PDF/print) generation, no direct-deposit / bank file
  export, and no manager approval step before a run is finalized — this
  build focused on getting the payroll calculation itself right first.
