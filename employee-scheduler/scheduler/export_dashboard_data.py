#!/usr/bin/env python3
"""
Exports the same roster x date monitoring data as generate_monitoring.py,
but as JSON for the HTML dashboard artifact instead of an .xlsx file.

Usage:
  python scheduler/export_dashboard_data.py --start "08 01 2026" --end "08 09 2026"
"""
import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_schedule import SCHED_DIR, load_roster, parse_file  # noqa: E402

# The two "Both" people are shown under a single section each for the
# dashboard's two-column layout (Barista / Kitchen), per explicit request --
# this only affects display grouping, not their scheduling eligibility in
# roster.json's "roles" map, which still marks them Both.
DASHBOARD_SECTION_OVERRIDE = {
    "VILLANUEVA": "Barista",
    "OCAMPO": "Kitchen",
}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--start", required=True, help="Start date 'MM DD YYYY'")
    ap.add_argument("--end", required=True, help="End date 'MM DD YYYY'")
    ap.add_argument("--out", default=None, help="Output .json path")
    args = ap.parse_args()

    start = datetime.strptime(args.start, "%m %d %Y").date()
    end = datetime.strptime(args.end, "%m %d %Y").date()

    roster_cfg = load_roster()
    aliases = roster_cfg.get("name_aliases", {})
    roster = roster_cfg["roster"]
    roles_map = roster_cfg.get("roles", {})

    dates = []
    d = start
    while d <= end:
        dates.append(d)
        d += timedelta(days=1)

    day_data = {}
    missing = []
    for d in dates:
        path = SCHED_DIR / f"{d.strftime('%m %d %Y')}.txt"
        if not path.exists():
            missing.append(d)
            continue
        _, worked, off = parse_file(path, aliases)
        day_data[d] = (worked, off)

    leave_by_date = {}
    for d in dates:
        leaves = {}
        for name, value in roster_cfg.get("on_leave", {}).items():
            # Same list-or-single-dict normalization as generate_schedule.py's
            # active_leave() -- a person can have more than one leave period
            # on record.
            periods = value if isinstance(value, list) else [value]
            for info in periods:
                since = datetime.strptime(info["since"], "%Y-%m-%d").date()
                until = datetime.strptime(info["until"], "%Y-%m-%d").date() if info.get("until") else None
                if since <= d and (until is None or d <= until):
                    leaves[name] = info.get("note", "")
                    break
        leave_by_date[d] = leaves

    people = []
    for name in roster:
        role = roles_map.get(name)
        section = DASHBOARD_SECTION_OVERRIDE.get(name, role if role in ("Barista", "Kitchen") else "Unclassified")
        days = []
        worked_count = off_count = leave_count = 0
        for d in dates:
            if d not in day_data:
                days.append({"date": d.isoformat(), "state": "unknown"})
                continue
            worked, off = day_data[d]
            leaves_today = leave_by_date[d]
            if name in leaves_today:
                days.append({"date": d.isoformat(), "state": "leave", "note": leaves_today[name]})
                leave_count += 1
            elif name in worked:
                shifts = [{"location": loc, "shift": shift, "role": wrole} for loc, shift, wrole in worked[name]]
                days.append({"date": d.isoformat(), "state": "worked", "shifts": shifts})
                worked_count += 1
            elif name in off:
                days.append({"date": d.isoformat(), "state": "off"})
                off_count += 1
            else:
                days.append({"date": d.isoformat(), "state": "blank"})

        people.append({
            "name": name,
            "role": role,
            "section": section,
            "days": days,
            "summary": {"worked": worked_count, "off": off_count, "leave": leave_count},
        })

    open_shifts = []
    for d in dates:
        if d not in day_data:
            continue
        worked, _off = day_data[d]
        path = SCHED_DIR / f"{d.strftime('%m %d %Y')}.txt"
        text = path.read_text(encoding="utf-8")
        if "NEEDS COVERAGE" in text.upper():
            for line in text.splitlines():
                if "NEEDS COVERAGE" in line.upper():
                    open_shifts.append({"date": d.isoformat(), "line": line.strip()})

    out = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "dates": [d.isoformat() for d in dates],
        "people": people,
        "open_shifts": open_shifts,
        "missing_dates": [d.isoformat() for d in missing],
    }

    out_path = Path(args.out) if args.out else Path(__file__).resolve().parent.parent / "dashboard_data.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Written to {out_path}")
    if missing:
        print("WARNING: no schedule file found for:", ", ".join(d.strftime("%m %d %Y") for d in missing))


if __name__ == "__main__":
    main()
