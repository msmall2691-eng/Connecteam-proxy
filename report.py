#!/usr/bin/env python3
"""
Connecteam Weekly Report Generator
Pulls timesheet + mileage data from the Connecteam API proxy
and generates a weekly synopsis per employee.

Usage:
  python3 report.py                          # Last 4 weeks
  python3 report.py --weeks 8                # Last 8 weeks
  python3 report.py --start 2026-01-01 --end 2026-03-29  # Custom range
  python3 report.py --output reports/march.md             # Custom output file
"""

import argparse
import json
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from collections import defaultdict
import time
import os

PROXY_BASE = "https://connecteam-proxy.vercel.app/api/connecteam"
API_KEY = os.environ.get("CONNECTEAM_API_KEY", "e8192411-e34d-4941-96ac-d998dabc05ce")
TIME_CLOCK_ID = 15248536

USER_MAP = {}


def api_get(path, params=None, retries=3):
    """Make a GET request to the Connecteam API via the proxy."""
    query = f"path={path}"
    if params:
        for k, v in params.items():
            query += f"&{k}={v}"
    url = f"{PROXY_BASE}?{query}"

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url)
            req.add_header("X-API-KEY", API_KEY)
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode()
                if body.startswith("<!DOCTYPE"):
                    return None
                data = json.loads(body)
                if "detail" in data and data["detail"] == "Too many requests":
                    wait = 2 ** (attempt + 1)
                    print(f"  Rate limited, waiting {wait}s...")
                    time.sleep(wait)
                    continue
                if "detail" in data and data["detail"] == "Not Found":
                    return None
                return data
        except (urllib.error.URLError, json.JSONDecodeError) as e:
            if attempt < retries - 1:
                time.sleep(2)
            else:
                print(f"  Error fetching {path}: {e}")
                return None
    return None


def fetch_users():
    """Fetch all users and build the user map."""
    global USER_MAP
    resp = api_get("users/v1/users")
    if not resp:
        return
    for u in resp["data"]["users"]:
        title = ""
        team = ""
        pay_rate = ""
        for f in u.get("customFields", []):
            if f["name"] == "Title":
                title = f["value"]
            elif f["name"] == "Team":
                title_vals = f.get("value", [])
                if title_vals:
                    team = title_vals[0]["value"]
        USER_MAP[u["userId"]] = {
            "name": f"{u['firstName']} {u['lastName']}",
            "role": u["userType"],
            "title": title,
            "team": team,
        }


def get_week_boundaries(start_date, end_date):
    """Split a date range into Monday-Sunday week boundaries."""
    weeks = []
    current = start_date
    # Align to Monday
    current -= timedelta(days=current.weekday())
    while current < end_date:
        week_end = min(current + timedelta(days=6), end_date)
        weeks.append((current, week_end))
        current += timedelta(days=7)
    return weeks


def fetch_week_data(week_start, week_end):
    """Fetch timesheet and time activity data for a given week."""
    start_str = week_start.strftime("%Y-%m-%d")
    end_str = week_end.strftime("%Y-%m-%d")

    timesheet = api_get(
        f"time-clock/v1/time-clocks/{TIME_CLOCK_ID}/timesheet",
        {"startDate": start_str, "endDate": end_str},
    )
    time.sleep(4)

    activities = api_get(
        f"time-clock/v1/time-clocks/{TIME_CLOCK_ID}/time-activities",
        {"startDate": start_str, "endDate": end_str},
    )

    return timesheet, activities


def format_time(ts):
    """Format a unix timestamp to a readable time string."""
    return datetime.fromtimestamp(ts).strftime("%I:%M%p").lstrip("0").lower()


def format_date(ts):
    """Format a unix timestamp to day of week + date."""
    return datetime.fromtimestamp(ts).strftime("%a %m/%d")


def generate_employee_week(user_id, timesheet_user, activities_user):
    """Generate a weekly report section for one employee."""
    name = USER_MAP.get(user_id, {}).get("name", f"User {user_id}")
    title = USER_MAP.get(user_id, {}).get("title", "")
    title_str = f" ({title})" if title else ""

    lines = []

    # Timesheet summary
    total_hours = 0
    total_pay = 0
    days_worked = 0
    approved_count = 0
    submitted_count = 0

    if timesheet_user:
        records = timesheet_user.get("dailyRecords", [])
        days_worked = len(records)
        for rec in records:
            total_hours += rec["dailyTotalHours"]
            total_pay += sum(p.get("totalPay", 0) for p in rec.get("payItems", []))
            if rec.get("isApproved"):
                approved_count += 1
            if rec.get("isSubmitted"):
                submitted_count += 1

    # Activity details with mileage
    shifts = []
    total_miles = 0
    notes = []

    if activities_user:
        for s in activities_user.get("shifts", []):
            start_ts = s["start"]["timestamp"]
            end_ts = s["end"]["timestamp"]
            hours = (end_ts - start_ts) / 3600
            loc = s["start"].get("locationData", {}).get("address", "Unknown")
            # Shorten location
            loc_short = loc.split(",")[0] if loc else "Unknown"

            miles = None
            for a in s.get("shiftAttachments", []):
                if "number" in a.get("attachment", {}):
                    miles = a["attachment"]["number"]
                    total_miles += miles

            note = s.get("employeeNote", "")
            if note:
                notes.append(f"{format_date(start_ts)}: \"{note.strip()}\"")

            shifts.append({
                "date": format_date(start_ts),
                "start": format_time(start_ts),
                "end": format_time(end_ts),
                "hours": hours,
                "miles": miles,
                "location": loc_short,
                "note": note.strip() if note else "",
            })

    if not shifts and total_hours == 0:
        return None  # Skip employees with no activity

    lines.append(f"### {name}{title_str}")
    lines.append("")
    lines.append(
        f"| Hours | Pay | Miles | Days Worked | Approved | Submitted |"
    )
    lines.append(f"|---|---|---|---|---|---|")
    lines.append(
        f"| {total_hours:.1f}h | ${total_pay:.2f} | {total_miles:.1f} | {days_worked} | "
        f"{'Yes' if approved_count == days_worked and days_worked > 0 else f'{approved_count}/{days_worked}'} | "
        f"{'Yes' if submitted_count == days_worked and days_worked > 0 else f'{submitted_count}/{days_worked}'} |"
    )
    lines.append("")

    if shifts:
        lines.append("| Day | Time | Hours | Miles | Location | Notes |")
        lines.append("|---|---|---|---|---|---|")
        for s in shifts:
            miles_str = f"{s['miles']}" if s["miles"] is not None else "—"
            note_str = s["note"] if s["note"] else ""
            lines.append(
                f"| {s['date']} | {s['start']}–{s['end']} | {s['hours']:.1f}h | "
                f"{miles_str} | {s['location']} | {note_str} |"
            )
        lines.append("")

    # Flag issues
    flags = []
    if total_miles > 1000:
        flags.append(f"Mileage entry may be incorrect ({total_miles:.0f} miles)")
    if approved_count < days_worked and days_worked > 0:
        flags.append(f"Timesheets not fully approved ({approved_count}/{days_worked})")
    if submitted_count < days_worked and days_worked > 0:
        flags.append(f"Timesheets not fully submitted ({submitted_count}/{days_worked})")
    for s in shifts:
        if s["hours"] < 0.05 and s["hours"] >= 0:
            flags.append(f"Very short clock-in on {s['date']} ({s['hours']*60:.0f} min)")
        if s["miles"] and s["miles"] > 200:
            flags.append(f"Unusually high mileage on {s['date']}: {s['miles']} mi")

    if flags:
        lines.append("**Flags:**")
        for f in flags:
            lines.append(f"- {f}")
        lines.append("")

    return "\n".join(lines)


def generate_report(start_date, end_date):
    """Generate the full weekly report."""
    print(f"Fetching users...")
    fetch_users()
    time.sleep(1)

    weeks = get_week_boundaries(start_date, end_date)
    report_lines = []

    report_lines.append("# Connecteam Weekly Report")
    report_lines.append(f"**Company:** The Maine Cleaning & Property Management Co.")
    report_lines.append(
        f"**Report Period:** {start_date.strftime('%B %d, %Y')} – {end_date.strftime('%B %d, %Y')}"
    )
    report_lines.append(f"**Generated:** {datetime.now().strftime('%B %d, %Y at %I:%M %p')}")
    report_lines.append("")
    report_lines.append("---")
    report_lines.append("")

    # Grand totals
    grand_totals = defaultdict(lambda: {"hours": 0, "pay": 0, "miles": 0, "days": 0})

    for week_start, week_end in weeks:
        week_label = f"{week_start.strftime('%b %d')} – {week_end.strftime('%b %d, %Y')}"
        print(f"Fetching week: {week_label}...")

        timesheet, activities = fetch_week_data(week_start, week_end)
        time.sleep(4)

        report_lines.append(f"## Week of {week_label}")
        report_lines.append("")

        # Index data by user
        ts_by_user = {}
        act_by_user = {}

        if timesheet and "data" in timesheet:
            for u in timesheet["data"].get("users", []):
                ts_by_user[u["userId"]] = u

        if activities and "data" in activities:
            for u in activities["data"].get("timeActivitiesByUsers", []):
                act_by_user[u["userId"]] = u

        all_user_ids = set(list(ts_by_user.keys()) + list(act_by_user.keys()))
        any_output = False

        for uid in sorted(all_user_ids):
            section = generate_employee_week(
                uid, ts_by_user.get(uid), act_by_user.get(uid)
            )
            if section:
                report_lines.append(section)
                any_output = True

                # Accumulate grand totals
                ts = ts_by_user.get(uid)
                act = act_by_user.get(uid)
                if ts:
                    for rec in ts.get("dailyRecords", []):
                        grand_totals[uid]["hours"] += rec["dailyTotalHours"]
                        grand_totals[uid]["pay"] += sum(
                            p.get("totalPay", 0) for p in rec.get("payItems", [])
                        )
                        grand_totals[uid]["days"] += 1
                if act:
                    for s in act.get("shifts", []):
                        for a in s.get("shiftAttachments", []):
                            if "number" in a.get("attachment", {}):
                                grand_totals[uid]["miles"] += a["attachment"]["number"]

        if not any_output:
            report_lines.append("*No activity recorded this week.*")
            report_lines.append("")

        report_lines.append("---")
        report_lines.append("")

    # Grand summary
    report_lines.append("## Grand Summary")
    report_lines.append("")
    report_lines.append("| Employee | Total Hours | Total Pay | Total Miles | Days Worked |")
    report_lines.append("|---|---|---|---|---|")

    sum_hours = 0
    sum_pay = 0
    sum_miles = 0
    sum_days = 0

    for uid in sorted(grand_totals.keys()):
        name = USER_MAP.get(uid, {}).get("name", f"User {uid}")
        t = grand_totals[uid]
        report_lines.append(
            f"| {name} | {t['hours']:.1f}h | ${t['pay']:.2f} | {t['miles']:.1f} | {t['days']} |"
        )
        sum_hours += t["hours"]
        sum_pay += t["pay"]
        sum_miles += t["miles"]
        sum_days += t["days"]

    report_lines.append(
        f"| **TOTAL** | **{sum_hours:.1f}h** | **${sum_pay:.2f}** | **{sum_miles:.1f}** | **{sum_days}** |"
    )
    report_lines.append("")

    return "\n".join(report_lines)


def main():
    parser = argparse.ArgumentParser(description="Connecteam Weekly Report Generator")
    parser.add_argument("--weeks", type=int, default=4, help="Number of weeks to report (default: 4)")
    parser.add_argument("--start", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, help="End date (YYYY-MM-DD)")
    parser.add_argument("--output", type=str, default="weekly-report.md", help="Output file (default: weekly-report.md)")
    parser.add_argument("--api-key", type=str, help="Connecteam API key (or set CONNECTEAM_API_KEY env var)")
    args = parser.parse_args()

    if args.api_key:
        global API_KEY
        API_KEY = args.api_key

    if args.start and args.end:
        start_date = datetime.strptime(args.start, "%Y-%m-%d")
        end_date = datetime.strptime(args.end, "%Y-%m-%d")
    else:
        end_date = datetime.now()
        start_date = end_date - timedelta(weeks=args.weeks)

    report = generate_report(start_date, end_date)

    os.makedirs(os.path.dirname(args.output) if os.path.dirname(args.output) else ".", exist_ok=True)
    with open(args.output, "w") as f:
        f.write(report)

    print(f"\nReport saved to: {args.output}")


if __name__ == "__main__":
    main()
