# Employee Scheduler

A draft-schedule generator for a multi-location business running rotating shifts.
Reads the last few days of actual schedules, figures out who worked and who was
off, and drafts the next day's assignment — fixed "anchor" roles first, then the
remaining pool slots — while respecting leave, one-off requests, and each
person's role (Barista-only, Kitchen-only, or flexible).

This is a sanitized, fully synthetic version of a scheduler I run for a real
multi-branch business. All names, dates, and leave reasons below are made up —
same shape and same code as the real one, none of the real data.

## What it actually does

- **Anchors get their slot first.** Most shifts have one person who normally
  holds them. If that person's off or on leave, the script looks back through
  recent history for whoever covered that exact slot most recently and is
  still available, and substitutes them — not just "pick anyone."
- **Day-offs are picked by fairness, not randomly.** Whoever's gone the longest
  without a day off is next in line — but only if giving them the day off
  doesn't leave a role uncovered (a Kitchen slot can't go unfilled because the
  next fairest pick happens to be Kitchen-only).
- **One-off requests get honored, then consumed.** A forced day-off or a
  location-lock for a specific date lives in `requests.json` until that date's
  schedule is generated, then it's cleared — the written schedule file becomes
  the permanent record.
- **Nothing fails silently.** If a request can't be honored, or a slot can't be
  filled, or something is genuinely ambiguous, it's printed as a warning to
  read before trusting the draft — not swallowed.

## Try it

```bash
pip install openpyxl
python scheduler/generate_schedule.py --dry-run          # draft the next day, don't write it
python scheduler/generate_monitoring.py --start "08 25 2026" --end "08 29 2026"
python scheduler/export_dashboard_data.py --start "08 25 2026" --end "08 29 2026"
```

`Previous Schedules/` has five days of sample history already in it, so
`--dry-run` works immediately and drafts August 30 — including honoring a
same-day location-lock request and flagging one it *can't* honor, both from
`requests.json`.

## Files

| File | Purpose |
|---|---|
| `scheduler/generate_schedule.py` | Reads history, drafts the next day, prints warnings |
| `scheduler/generate_monitoring.py` | Builds a roster × date Excel sheet from the history |
| `scheduler/export_dashboard_data.py` | Same data as JSON, for a dashboard front-end |
| `scheduler/roster.json` | Who's on the roster, their role, anchors, leave, aliases |
| `scheduler/requests.json` | Pending one-off requests for the next generation |
| `Previous Schedules/*.txt` | Sample history the generator reads from |

## Found and fixed during testing

`generate_monitoring.py` and `export_dashboard_data.py` both crashed on a
person with more than one leave period on record — `roster.json` allows a
single leave entry or a list of them, and `generate_schedule.py`'s own
`active_leave()` already handled both, but the other two scripts assumed a
single entry and threw a `TypeError` the moment a list showed up. Fixed by
mirroring the same normalization in both places. Caught by actually running
all three scripts against a roster where two people had multiple leave
periods, not by code review.
