#!/usr/bin/env python3
"""
Draft schedule generator for employee-scheduler-v3.

Reads the .txt files in "Previous Schedules/", figures out who worked and
who was off on the most recent day, and drafts the next day's schedule:
  - anchor roles (roster.json) are assigned to their fixed person
  - pool slots are filled from whoever in the rotation pool is working
  - the day-off list excludes anyone who was off the day before
  - people on multi-day leave (roster.json) are left off entirely
  - one-off requests in requests.json (forced day-off, location-lock for
    a specific date) are honored, then cleared from that file once used

This produces a DRAFT for review, not a verified schedule. Anchor
conflicts (an anchor person on leave) and any other judgment calls are
printed as warnings -- read them before using the file.
"""
import argparse
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
SCHED_DIR = ROOT / "Previous Schedules"
ROSTER_PATH = Path(__file__).resolve().parent / "roster.json"
REQUESTS_PATH = Path(__file__).resolve().parent / "requests.json"
REQUESTS_COMMENT = (
    "Pending one-off requests for the next schedule generation. Each entry applies "
    "to a single 'date' (YYYY-MM-DD) and is cleared automatically by "
    "generate_schedule.py once that date has been generated -- the written .txt "
    "schedule is the permanent record after that. Types: 'day_off' (force this "
    "person off that day, ahead of the normal rotation) and 'location_lock' "
    "(if working, restrict them to one location: MAIN/MARFORI/MINTAL/TORIL/SASA/BISTRO). "
    "For multi-day leave, use roster.json's on_leave instead."
)

LOCATIONS = {"MAIN", "MARFORI", "MINTAL", "TORIL", "SASA", "BISTRO"}
SHIFTS = {"GY", "AM", "PM"}

OFF_KEYWORDS = ("day off", "leave", "standby")


def load_roster():
    return json.loads(ROSTER_PATH.read_text(encoding="utf-8"))


def load_requests():
    if not REQUESTS_PATH.exists():
        return []
    return json.loads(REQUESTS_PATH.read_text(encoding="utf-8")).get("requests", [])


def save_requests(requests):
    REQUESTS_PATH.write_text(
        json.dumps({"_comment": REQUESTS_COMMENT, "requests": requests}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def requests_for_date(requests, target_date, aliases):
    """Split requests.json entries that apply to target_date into a day-off name
    set and a name->location lock dict; entries for other dates are ignored here."""
    day_off = set()
    location_lock = {}
    warnings = []
    for r in requests:
        try:
            d = datetime.strptime(r.get("date", ""), "%Y-%m-%d").date()
        except ValueError:
            continue
        if d != target_date:
            continue
        name = normalize_name(r.get("name", ""), aliases)
        rtype = r.get("type")
        if rtype == "day_off":
            day_off.add(name)
        elif rtype == "location_lock":
            location_lock[name] = (r.get("location") or "").strip().upper()
        else:
            warnings.append(f"Request for {name} on {target_date} has unknown type '{rtype}' -- ignored.")
    return day_off, location_lock, warnings


def normalize_name(raw, aliases):
    name = re.sub(r"\s+", " ", raw.strip()).upper()
    name = name.strip("-: ")
    return aliases.get(name, name)


def parse_date_line(line):
    line = line.strip().rstrip(",")
    # "JULY 29, 2026" -> also handle stray double spaces
    line = re.sub(r"\s+", " ", line).replace(",", "")
    return datetime.strptime(line, "%B %d %Y").date()


def parse_file(path, aliases):
    lines = path.read_text(encoding="utf-8").splitlines()
    d = parse_date_line(lines[1]) if len(lines) > 1 else None

    location = None
    shift = None
    worked = {}  # name -> list of (location, shift, role), >1 entry for a double shift
    off = {}     # name -> reason

    for raw in lines[3:]:
        line = raw.strip()
        if not line:
            continue
        head = line.upper().split("(")[0].strip().rstrip(":")

        if head in LOCATIONS:
            location = head
            shift = None
            continue
        if head in SHIFTS:
            shift = head
            continue

        m = re.match(r"^(Barista|Kitchen)\s*:\s*(.+?)\s*\(", line, re.IGNORECASE)
        if m:
            role = m.group(1).capitalize()
            name = normalize_name(m.group(2), aliases)
            worked.setdefault(name, []).append((location, shift, role))
            continue

        low = line.lower()
        if any(k in low for k in OFF_KEYWORDS):
            # strip a trailing "(...)" note like "(July 25-26)" before the keyword split
            head_part = re.split(r"day off|leave|standby|-|:", line, flags=re.IGNORECASE)[0]
            name = normalize_name(head_part, aliases)
            if name:
                reason = next(k for k in OFF_KEYWORDS if k in low)
                off[name] = reason

    return d, worked, off


def build_history(aliases):
    history = {}  # date -> (worked, off)
    for path in SCHED_DIR.glob("*.txt"):
        try:
            d, worked, off = parse_file(path, aliases)
        except Exception as e:
            print(f"warning: could not parse {path.name}: {e}", file=sys.stderr)
            continue
        if d:
            history[d] = (worked, off)
    return history


def days_since_last_off(name, history, before_date):
    """Count consecutive days worked up to (not including) before_date."""
    streak = 0
    d = before_date - timedelta(days=1)
    seen_any = False
    while d in history:
        worked, off = history[d]
        if name in off:
            break
        if name in worked or True:  # count the day even if slot wasn't matched
            seen_any = True
            streak += 1
        d -= timedelta(days=1)
    return streak if seen_any else 999  # never seen off -> treat as most overdue


def active_leave(roster_cfg, target_date):
    """Each person's on_leave value is either a single {since,until,note} dict
    or a list of them, for people with more than one leave period on record."""
    leaves = {}
    for name, value in roster_cfg.get("on_leave", {}).items():
        periods = value if isinstance(value, list) else [value]
        for info in periods:
            since = datetime.strptime(info["since"], "%Y-%m-%d").date()
            until = datetime.strptime(info["until"], "%Y-%m-%d").date() if info.get("until") else None
            if since <= target_date and (until is None or target_date <= until):
                leaves[name] = info
                break
    return leaves


def can_fill(name, role, roles_map):
    """Strict role check: a person may only be assigned a role they're marked for.
    'Both' can take either; an unlisted person is allowed anywhere (missing data,
    not permission) but should be added to roster.json's roles map."""
    r = roles_map.get(name)
    return r is None or r == role or r == "Both"


def pick_candidate(names, role, roles_map):
    """Among eligible candidates, prefer someone locked to this exact role over a
    flexible 'Both'/unlisted person, so flex people stay free for slots that only
    they can cover -- otherwise a flex pick can stall a role-locked person with no
    remaining slot to fall back to."""
    locked = [n for n in names if roles_map.get(n) == role]
    return locked[0] if locked else names[0]


def generate(target_date, roster_cfg, history, requests=None):
    roster = roster_cfg["roster"]
    roles_map = roster_cfg.get("roles", {})
    location_restrictions = roster_cfg.get("location_restrictions", {})
    shift_restrictions = roster_cfg.get("shift_restrictions", {})
    no_pair = {}
    for a, b in roster_cfg.get("no_pair", []):
        no_pair.setdefault(a, set()).add(b)
        no_pair.setdefault(b, set()).add(a)
    aliases = roster_cfg.get("name_aliases", {})
    anchors = {tuple(slot.split("|")): name for slot, name in roster_cfg["anchors"].items()}
    pool_slots = [tuple(s) for s in roster_cfg["pool_slots"]]
    all_slots = list(anchors.keys()) + pool_slots
    warnings = []

    leave_today = active_leave(roster_cfg, target_date)

    req_day_off, location_locks, req_warnings = requests_for_date(requests or [], target_date, aliases)
    warnings.extend(req_warnings)

    unknown = req_day_off - set(roster)
    for n in unknown:
        warnings.append(f"Day-off request for '{n}' does not match anyone on the roster -- check spelling in requests.json.")
    req_day_off -= unknown

    redundant = req_day_off & set(leave_today)
    for n in redundant:
        warnings.append(f"Day-off request for {n} on {target_date} is redundant -- already on multi-day leave.")
    req_day_off -= redundant

    valid_locks = {}
    for n, loc in location_locks.items():
        if n not in roster:
            warnings.append(f"Location-lock request for '{n}' does not match anyone on the roster -- check spelling in requests.json.")
        elif loc not in LOCATIONS:
            warnings.append(f"Location-lock request for {n} names an unknown location '{loc}' -- ignored.")
        else:
            valid_locks[n] = loc
    location_locks = valid_locks

    prev_date = target_date - timedelta(days=1)
    prev_worked, prev_off = history.get(prev_date, ({}, {}))

    # Everyone not on multi-day leave is eligible to work or take a rotating
    # day off today -- anchors included. An anchor is a *preference* for a
    # slot, not an exemption from rotation.
    pool = [n for n in roster if n not in leave_today]
    must_work = {n for n in pool if n in prev_off}  # off yesterday -> must work today
    forced_off = [n for n in req_day_off if n in pool]

    num_off = len(pool) - len(all_slots)
    if num_off < 0:
        warnings.append(f"Pool ({len(pool)}) is smaller than total slots ({len(all_slots)}); some slots will be left BLANK.")
        num_off = 0

    # Role capacity: Barista-only and Kitchen-only people can only ever cover
    # their own slots; "Both" (and unlisted) people are flexible and can plug
    # either side. A day-off pick is only safe if, after removing them, the
    # remaining pool can still cover every Barista slot and every Kitchen
    # slot (Both/unlisted people counted toward whichever side is short).
    barista_slots = sum(1 for _, _, role in all_slots if role == "Barista")
    kitchen_slots = sum(1 for _, _, role in all_slots if role == "Kitchen")

    def role_capacity(names):
        barista_only = kitchen_only = flex = 0
        for n in names:
            r = roles_map.get(n)
            if r == "Barista":
                barista_only += 1
            elif r == "Kitchen":
                kitchen_only += 1
            else:
                flex += 1  # "Both" or unlisted
        return barista_only, kitchen_only, flex

    def covers_slots(names):
        bo, ko, flex = role_capacity(names)
        return bo + flex >= barista_slots and ko + flex >= kitchen_slots

    def eligible(n, loc, shift, role):
        """can_fill plus today's location_lock requests, if any, plus any
        standing location_restrictions/shift_restrictions from roster.json,
        plus no_pair conflicts (two people who must never share the same
        location+shift)."""
        if not can_fill(n, role, roles_map):
            return False
        allowed = location_restrictions.get(n)
        if allowed is not None and loc not in allowed:
            return False
        barred_shifts = shift_restrictions.get(n)
        if barred_shifts is not None and shift in barred_shifts:
            return False
        lock = location_locks.get(n)
        if lock is not None and lock != loc:
            return False
        partners = no_pair.get(n)
        if partners:
            for (l, s, _r), occ in assignment.items():
                if l == loc and s == shift and occ in partners:
                    return False
        return True

    day_off = list(forced_off)
    working_set = set(pool) - set(forced_off)
    if forced_off and not covers_slots(working_set):
        warnings.append(f"Honoring day-off request(s) for {', '.join(sorted(forced_off))} leaves role coverage short today -- expect a blank slot.")
    for n in forced_off:
        if n in must_work:
            warnings.append(f"{n} was off yesterday and also has a day-off request for today -- back-to-back day off (request honored).")

    ranked = sorted(
        [n for n in pool if n not in forced_off],
        key=lambda n: (-days_since_last_off(n, history, target_date), n in must_work, n),
    )
    off_candidates = [n for n in ranked if n not in must_work]

    for n in off_candidates:
        if len(day_off) >= num_off:
            break
        trial = working_set - {n}
        if covers_slots(trial):
            working_set = trial
            day_off.append(n)
        else:
            warnings.append(f"{n} is next in line for a day off but role coverage requires them to work today.")

    if num_off and len(day_off) < num_off:
        warnings.append("Could not find enough people to take off without breaking role coverage; fewer day-offs than the pool/slot count implies.")

    working_pool = [n for n in pool if n not in day_off]
    remaining = list(working_pool)
    assignment = {}

    # 1. Anchors get their slot first, if they're working today.
    for slot, name in anchors.items():
        if name in remaining:
            assignment[slot] = name
            remaining.remove(name)

    # 2. Empty anchor slots get a substitute: whoever filled that exact slot
    #    most recently in history and is still available, else next in line.
    for slot in anchors:
        if slot in assignment:
            continue
        loc, shift, role = slot
        sub = None
        for d in sorted(history.keys(), reverse=True):
            worked, _ = history[d]
            for n, entries in worked.items():
                if n not in remaining or not eligible(n, loc, shift, role):
                    continue
                if any(l == loc and s == shift and r == role for l, s, r in entries):
                    sub = n
                    break
            if sub:
                break
        if not sub:
            candidates = [n for n in remaining if eligible(n, loc, shift, role)]
            if candidates:
                sub = pick_candidate(candidates, role, roles_map)
        if sub:
            remaining.remove(sub)
        assignment[slot] = sub
        if sub:
            warnings.append(f"Anchor {anchors[slot]} is off/on leave for {slot} -- substituted {sub}.")
        else:
            warnings.append(f"Anchor {anchors[slot]} is off/on leave for {slot} -- no one left to substitute.")

    # 3. Pool slots: keep yesterday's person if still available, else fill in order.
    for slot in pool_slots:
        loc, shift, role = slot
        prior_name = None
        for n, entries in prev_worked.items():
            if n not in remaining or not eligible(n, loc, shift, role):
                continue
            if any(l == loc and s == shift and r == role for l, s, r in entries):
                prior_name = n
                break
        if prior_name:
            assignment[slot] = prior_name
            remaining.remove(prior_name)
    for slot in pool_slots:
        if slot not in assignment:
            loc, shift, role = slot
            candidates = [n for n in remaining if eligible(n, loc, shift, role)]
            if candidates:
                pick = pick_candidate(candidates, role, roles_map)
                assignment[slot] = pick
                remaining.remove(pick)
            else:
                assignment[slot] = None
                warnings.append(f"No one left to fill {slot} matching required role ({role}).")

    # Final sanity check: nothing should have slipped through with the wrong role.
    for (loc, shift, role), name in assignment.items():
        if name and not can_fill(name, role, roles_map):
            warnings.append(f"ROLE VIOLATION: {name} assigned to {role} slot ({loc}, {shift}) but is {roles_map.get(name)}-only.")

    accounted = set(v for v in assignment.values() if v) | set(day_off) | set(leave_today)
    unaccounted = set(roster) - accounted
    stranded_by_lock = unaccounted & set(location_locks)
    for n in sorted(stranded_by_lock):
        warnings.append(f"Location-lock request for {n} ({location_locks[n]}) could not be honored -- no eligible slot open there today.")
    unaccounted -= stranded_by_lock
    if unaccounted:
        warnings.append(f"Not on any list (script bug -- please report): {', '.join(sorted(unaccounted))}")

    return assignment, day_off, leave_today, warnings


def render(target_date, assignment, day_off, leave_today, roster_cfg):
    def get(loc, shift, role):
        return assignment.get((loc, shift, role)) or "___"

    toril_status = roster_cfg["locations_status"].get("TORIL", "closed")
    bistro_status = roster_cfg["locations_status"].get("BISTRO", "closed")

    lines = []
    lines.append("SCHEDULE")
    lines.append(f"{target_date.strftime('%B %-d, %Y').upper()}" if sys.platform != "win32"
                  else f"{target_date.strftime('%B %#d, %Y').upper()}")
    lines.append(target_date.strftime("%A").upper())
    lines.append("")
    lines.append("MAIN")
    lines.append("")
    lines.append("GY")
    lines.append(f"Barista: {get('MAIN','GY','Barista')} (2am-10am)")
    lines.append(f"Kitchen: {get('MAIN','GY','Kitchen')} (2am-10am)")
    lines.append("")
    lines.append("AM")
    lines.append(f"Barista: {get('MAIN','AM','Barista')} (10am-6pm)")
    lines.append(f"Kitchen: {get('MAIN','AM','Kitchen')} (10am-6pm)")
    lines.append("")
    lines.append("PM")
    lines.append(f"Barista: {get('MAIN','PM','Barista')} (6pm-2am)")
    lines.append(f"Kitchen: {get('MAIN','PM','Kitchen')} (6pm-2am)")
    lines.append("")
    lines.append("Bistro")
    lines.append("Closed" if bistro_status == "closed" else "Kitchen: CANARIAS (11am-9pm)")
    lines.append("")
    lines.append("MARFORI")
    lines.append("")
    lines.append("AM")
    lines.append(f"Barista: {get('MARFORI','AM','Barista')} (10am-6pm)")
    lines.append(f"Kitchen: {get('MARFORI','AM','Kitchen')} (10am-6pm)")
    lines.append("")
    lines.append("PM")
    lines.append(f"Barista: {get('MARFORI','PM','Barista')} (6pm-2am)")
    lines.append(f"Kitchen: {get('MARFORI','PM','Kitchen')} (6pm-2am)")
    lines.append("")
    lines.append("MINTAL")
    lines.append("")
    lines.append("AM")
    lines.append(f"Barista: {get('MINTAL','AM','Barista')} (10am-6pm)")
    lines.append(f"Kitchen: {get('MINTAL','AM','Kitchen')} (10am-6pm)")
    lines.append("")
    lines.append("PM")
    lines.append(f"Barista: {get('MINTAL','PM','Barista')} (6pm-2am)")
    lines.append(f"Kitchen: {get('MINTAL','PM','Kitchen')} (6pm-2am)")
    lines.append("")
    lines.append("TORIL")
    lines.append("Temporarily closed" if toril_status == "closed" else "OPEN - fill in manually")
    lines.append("")
    lines.append("SASA")
    lines.append(f"Barista: {get('SASA','-','Barista')} (3pm-12mn 1hr break)")
    lines.append(f"Kitchen: {get('SASA','-','Kitchen')} (3pm-12mn 1hr break)")
    lines.append("")
    for name in day_off:
        lines.append(f"{name} day off")
    for name in leave_today:
        lines.append(f"{name} leave")
    lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", help="Target date as 'MM DD YYYY', default = day after the latest file", default=None)
    ap.add_argument("--dry-run", action="store_true", help="Print the draft, don't write the file")
    args = ap.parse_args()

    roster_cfg = load_roster()
    aliases = roster_cfg.get("name_aliases", {})
    history = build_history(aliases)
    requests = load_requests()

    if args.date:
        target_date = datetime.strptime(args.date, "%m %d %Y").date()
    else:
        latest = max(history.keys())
        target_date = latest + timedelta(days=1)

    assignment, day_off, leave_today, warnings = generate(target_date, roster_cfg, history, requests)
    text = render(target_date, assignment, day_off, leave_today, roster_cfg)

    print(text)
    print("-" * 40)
    if warnings:
        print("WARNINGS (review before using this draft):")
        for w in warnings:
            print(f"  - {w}")
    else:
        print("No warnings, but this is still an unverified draft -- review before use.")

    if not args.dry_run:
        out_path = SCHED_DIR / f"{target_date.strftime('%m %d %Y')}.txt"
        out_path.write_text(text, encoding="utf-8")
        print(f"\nWritten to {out_path}")

        target_str = target_date.strftime("%Y-%m-%d")
        applied = [r for r in requests if r.get("date") == target_str]
        if applied:
            save_requests([r for r in requests if r.get("date") != target_str])
            print(f"Cleared {len(applied)} request(s) from requests.json for {target_str} (now baked into the schedule file).")


if __name__ == "__main__":
    main()
