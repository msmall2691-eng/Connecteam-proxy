#!/usr/bin/env python3
"""
Connecteam Payroll Prep & Mileage Calculator
Generates a payroll-ready report with:
  - Hours worked per employee per week
  - Mileage reimbursement (miles over 35 to job + between jobs)
  - Pay breakdown
  - Flags for issues

Usage:
  python3 payroll.py                            # Current pay period (last 2 weeks)
  python3 payroll.py --weeks 1                  # Last week only
  python3 payroll.py --start 2026-03-16 --end 2026-03-29
  python3 payroll.py --rate 0.70                # Custom IRS mileage rate
  python3 payroll.py --threshold 35             # Custom mileage threshold
  python3 payroll.py --output payroll-march.md
"""

import argparse
import json
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from collections import defaultdict
import time
import os
import math

PROXY_BASE = "https://connecteam-proxy.vercel.app/api/connecteam"
API_KEY = os.environ.get("CONNECTEAM_API_KEY", "e8192411-e34d-4941-96ac-d998dabc05ce")
TIME_CLOCK_ID = 15248536
SCHEDULER_ID = 15248539

# 2025/2026 IRS standard mileage rate
IRS_MILEAGE_RATE = 0.70
# Miles threshold — only reimburse miles over this to the first job
MILEAGE_THRESHOLD = 35

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
                    wait = 2 ** (attempt + 2)
                    print(f"  Rate limited, waiting {wait}s...")
                    time.sleep(wait)
                    continue
                if "detail" in data and data["detail"] == "Not Found":
                    return None
                return data
        except (urllib.error.URLError, json.JSONDecodeError) as e:
            if attempt < retries - 1:
                time.sleep(3)
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
        pay_rate = None
        for f in u.get("customFields", []):
            if f["name"] == "Title":
                title = f["value"] if isinstance(f["value"], str) else ""
        USER_MAP[u["userId"]] = {
            "name": f"{u['firstName']} {u['lastName']}",
            "role": u["userType"],
            "title": title,
        }


def haversine_miles(lat1, lon1, lat2, lon2):
    """Calculate distance between two GPS coordinates in miles."""
    R = 3959  # Earth radius in miles
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def get_week_boundaries(start_date, end_date):
    """Split a date range into Monday-Sunday week boundaries."""
    weeks = []
    current = start_date
    current -= timedelta(days=current.weekday())
    while current < end_date:
        week_end = min(current + timedelta(days=6), end_date)
        weeks.append((current, week_end))
        current += timedelta(days=7)
    return weeks


def format_time(ts):
    return datetime.fromtimestamp(ts).strftime("%I:%M%p").lstrip("0").lower()


def format_date(ts):
    return datetime.fromtimestamp(ts).strftime("%a %m/%d")


def process_employee_week(user_id, timesheet_user, activities_user, mileage_threshold, irs_rate):
    """Process one employee's data for one week."""
    name = USER_MAP.get(user_id, {}).get("name", f"User {user_id}")
    title = USER_MAP.get(user_id, {}).get("title", "")

    result = {
        "user_id": user_id,
        "name": name,
        "title": title,
        "total_hours": 0,
        "total_pay": 0,
        "total_miles_reported": 0,
        "reimbursable_miles": 0,
        "mileage_reimbursement": 0,
        "days_worked": 0,
        "approved": 0,
        "submitted": 0,
        "daily": [],
        "flags": [],
    }

    # Timesheet data
    if timesheet_user:
        records = timesheet_user.get("dailyRecords", [])
        result["days_worked"] = len(records)
        for rec in records:
            result["total_hours"] += rec["dailyTotalHours"]
            result["total_pay"] += sum(p.get("totalPay", 0) for p in rec.get("payItems", []))
            if rec.get("isApproved"):
                result["approved"] += 1
            if rec.get("isSubmitted"):
                result["submitted"] += 1

    # Activity data — mileage calculation
    if activities_user:
        shifts = activities_user.get("shifts", [])
        # Group shifts by date
        shifts_by_date = defaultdict(list)
        for s in shifts:
            date_key = datetime.fromtimestamp(s["start"]["timestamp"]).strftime("%Y-%m-%d")
            shifts_by_date[date_key].append(s)

        for date_key in sorted(shifts_by_date.keys()):
            day_shifts = sorted(shifts_by_date[date_key], key=lambda s: s["start"]["timestamp"])
            day_miles_reported = 0
            day_reimbursable = 0
            day_details = []

            for i, s in enumerate(day_shifts):
                start_ts = s["start"]["timestamp"]
                end_ts = s["end"]["timestamp"]
                hours = (end_ts - start_ts) / 3600
                loc = s["start"].get("locationData", {}).get("address", "Unknown")
                loc_short = loc.split(",")[0] if loc else "Unknown"

                # Get reported mileage from attachment
                reported_miles = None
                for a in s.get("shiftAttachments", []):
                    if "number" in a.get("attachment", {}):
                        reported_miles = a["attachment"]["number"]

                if reported_miles is not None:
                    day_miles_reported += reported_miles

                    # First shift of the day: reimburse miles over threshold
                    if i == 0:
                        if reported_miles > mileage_threshold:
                            reimbursable = reported_miles - mileage_threshold
                            day_reimbursable += reimbursable
                        else:
                            reimbursable = 0
                    else:
                        # Between-job miles: fully reimbursable
                        reimbursable = reported_miles
                        day_reimbursable += reimbursable
                else:
                    reimbursable = 0

                note = s.get("employeeNote", "").strip()

                day_details.append({
                    "date": format_date(start_ts),
                    "start": format_time(start_ts),
                    "end": format_time(end_ts),
                    "hours": hours,
                    "location": loc_short,
                    "reported_miles": reported_miles,
                    "reimbursable_miles": reimbursable,
                    "note": note,
                    "is_first_job": i == 0,
                })

                # Flags
                if reported_miles and reported_miles > 200:
                    result["flags"].append(
                        f"Unusually high mileage on {format_date(start_ts)}: {reported_miles} mi — likely data entry error"
                    )
                if hours < 0.05 and hours >= 0:
                    result["flags"].append(
                        f"Very short clock-in on {format_date(start_ts)} ({hours * 60:.0f} min)")

            result["total_miles_reported"] += day_miles_reported
            result["reimbursable_miles"] += day_reimbursable
            result["daily"].extend(day_details)

    result["mileage_reimbursement"] = result["reimbursable_miles"] * irs_rate

    # More flags
    if result["days_worked"] > 0 and result["approved"] < result["days_worked"]:
        result["flags"].append(
            f"Timesheets not approved ({result['approved']}/{result['days_worked']})"
        )
    if result["days_worked"] > 0 and result["submitted"] < result["days_worked"]:
        result["flags"].append(
            f"Timesheets not submitted ({result['submitted']}/{result['days_worked']})"
        )

    return result


def generate_payroll_report(start_date, end_date, mileage_threshold, irs_rate):
    """Generate the full payroll report."""
    print("Fetching users...")
    fetch_users()
    time.sleep(2)

    weeks = get_week_boundaries(start_date, end_date)
    lines = []

    lines.append("# Payroll Prep & Mileage Reimbursement Report")
    lines.append(f"**Company:** The Maine Cleaning & Property Management Co.")
    lines.append(f"**Pay Period:** {start_date.strftime('%B %d, %Y')} – {end_date.strftime('%B %d, %Y')}")
    lines.append(f"**Generated:** {datetime.now().strftime('%B %d, %Y at %I:%M %p')}")
    lines.append(f"**IRS Mileage Rate:** ${irs_rate:.2f}/mile")
    lines.append(f"**Mileage Threshold:** {mileage_threshold} miles (first job of day)")
    lines.append("")
    lines.append("---")
    lines.append("")

    # Accumulate totals per employee across all weeks
    grand = defaultdict(lambda: {
        "name": "", "title": "", "hours": 0, "pay": 0,
        "miles_reported": 0, "reimbursable": 0, "reimbursement": 0,
        "days": 0, "flags": [],
    })

    for week_start, week_end in weeks:
        week_label = f"{week_start.strftime('%b %d')} – {week_end.strftime('%b %d, %Y')}"
        print(f"Fetching week: {week_label}...")

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
        time.sleep(4)

        # Index by user
        ts_by_user = {}
        act_by_user = {}
        if timesheet and "data" in timesheet:
            for u in timesheet["data"].get("users", []):
                ts_by_user[u["userId"]] = u
        if activities and "data" in activities:
            for u in activities["data"].get("timeActivitiesByUsers", []):
                act_by_user[u["userId"]] = u

        all_ids = set(list(ts_by_user.keys()) + list(act_by_user.keys()))

        lines.append(f"## Week of {week_label}")
        lines.append("")

        any_output = False
        for uid in sorted(all_ids):
            emp = process_employee_week(
                uid, ts_by_user.get(uid), act_by_user.get(uid),
                mileage_threshold, irs_rate
            )

            if emp["total_hours"] == 0 and not emp["daily"]:
                continue

            any_output = True
            name = emp["name"]
            title_str = f" ({emp['title']})" if emp["title"] else ""

            lines.append(f"### {name}{title_str}")
            lines.append("")

            # Summary table
            lines.append("| Hours | Hourly Pay | Miles Reported | Reimbursable Miles | Mileage Reimbursement | Total Comp |")
            lines.append("|---|---|---|---|---|---|")
            total_comp = emp["total_pay"] + emp["mileage_reimbursement"]
            lines.append(
                f"| {emp['total_hours']:.1f}h | ${emp['total_pay']:.2f} | "
                f"{emp['total_miles_reported']:.1f} | {emp['reimbursable_miles']:.1f} | "
                f"${emp['mileage_reimbursement']:.2f} | **${total_comp:.2f}** |"
            )
            lines.append("")

            # Daily detail
            if emp["daily"]:
                lines.append("| Day | Time | Hours | Location | Miles | Reimbursable | Notes |")
                lines.append("|---|---|---|---|---|---|---|")
                for d in emp["daily"]:
                    miles_str = f"{d['reported_miles']}" if d["reported_miles"] is not None else "—"
                    reimb_str = f"{d['reimbursable_miles']:.1f}" if d["reimbursable_miles"] else "0"
                    marker = " (to job)" if d["is_first_job"] else " (between)"
                    note = d["note"] if d["note"] else ""
                    lines.append(
                        f"| {d['date']} | {d['start']}–{d['end']} | {d['hours']:.1f}h | "
                        f"{d['location']} | {miles_str}{marker} | {reimb_str} | {note} |"
                    )
                lines.append("")

            # Flags
            if emp["flags"]:
                lines.append("**Flags:**")
                for f in emp["flags"]:
                    lines.append(f"- {f}")
                lines.append("")

            # Grand totals
            grand[uid]["name"] = emp["name"]
            grand[uid]["title"] = emp["title"]
            grand[uid]["hours"] += emp["total_hours"]
            grand[uid]["pay"] += emp["total_pay"]
            grand[uid]["miles_reported"] += emp["total_miles_reported"]
            grand[uid]["reimbursable"] += emp["reimbursable_miles"]
            grand[uid]["reimbursement"] += emp["mileage_reimbursement"]
            grand[uid]["days"] += emp["days_worked"]
            grand[uid]["flags"].extend(emp["flags"])

        if not any_output:
            lines.append("*No activity recorded this week.*")
            lines.append("")

        lines.append("---")
        lines.append("")

    # === PAYROLL SUMMARY ===
    lines.append("## Payroll Summary")
    lines.append("")
    lines.append("This is the final summary ready for Square Payroll entry.")
    lines.append("")
    lines.append("| Employee | Hours | Hourly Pay | Reimbursable Miles | Mileage Reimbursement | **Total Comp** |")
    lines.append("|---|---|---|---|---|---|")

    sum_hours = 0
    sum_pay = 0
    sum_reimb_miles = 0
    sum_reimb = 0
    sum_total = 0

    for uid in sorted(grand.keys()):
        g = grand[uid]
        total = g["pay"] + g["reimbursement"]
        lines.append(
            f"| {g['name']} | {g['hours']:.1f}h | ${g['pay']:.2f} | "
            f"{g['reimbursable']:.1f} | ${g['reimbursement']:.2f} | **${total:.2f}** |"
        )
        sum_hours += g["hours"]
        sum_pay += g["pay"]
        sum_reimb_miles += g["reimbursable"]
        sum_reimb += g["reimbursement"]
        sum_total += total

    lines.append(
        f"| **TOTAL** | **{sum_hours:.1f}h** | **${sum_pay:.2f}** | "
        f"**{sum_reimb_miles:.1f}** | **${sum_reimb:.2f}** | **${sum_total:.2f}** |"
    )
    lines.append("")

    # Issues to resolve
    all_flags = []
    for uid in grand:
        for f in grand[uid]["flags"]:
            all_flags.append(f"{grand[uid]['name']}: {f}")

    if all_flags:
        lines.append("## Issues to Resolve Before Processing")
        lines.append("")
        for f in all_flags:
            lines.append(f"- {f}")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Connecteam Payroll Prep & Mileage Calculator")
    parser.add_argument("--weeks", type=int, default=2, help="Number of weeks (default: 2)")
    parser.add_argument("--start", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, help="End date (YYYY-MM-DD)")
    parser.add_argument("--output", type=str, default="payroll-report.md", help="Output file")
    parser.add_argument("--rate", type=float, default=IRS_MILEAGE_RATE, help=f"IRS mileage rate (default: ${IRS_MILEAGE_RATE})")
    parser.add_argument("--threshold", type=float, default=MILEAGE_THRESHOLD, help=f"Mileage threshold for first job (default: {MILEAGE_THRESHOLD})")
    parser.add_argument("--api-key", type=str, help="Connecteam API key")
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

    report = generate_payroll_report(start_date, end_date, args.threshold, args.rate)

    os.makedirs(os.path.dirname(args.output) if os.path.dirname(args.output) else ".", exist_ok=True)
    with open(args.output, "w") as f:
        f.write(report)

    print(f"\nReport saved to: {args.output}")


if __name__ == "__main__":
    main()
