#!/usr/bin/env python3
"""
Connecteam Operations Dashboard
Generates reports for:
  1. Schedule Coverage — open shifts, rejections, gaps
  2. Attendance — scheduled vs actual, late clock-ins, missed shifts
  3. Client Job History — cleans per address, who cleaned, missed recurring cleans

Usage:
  python3 dashboard.py                              # All reports, last 2 weeks
  python3 dashboard.py --report schedule            # Schedule coverage only
  python3 dashboard.py --report attendance          # Attendance only
  python3 dashboard.py --report jobs                # Client job history only
  python3 dashboard.py --weeks 4                    # Last 4 weeks
  python3 dashboard.py --start 2026-03-01 --end 2026-03-29
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
SCHEDULER_ID = 15248539

USER_MAP = {}


def api_get(path, params=None, retries=3):
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
    global USER_MAP
    resp = api_get("users/v1/users")
    if not resp:
        return
    for u in resp["data"]["users"]:
        title = ""
        for f in u.get("customFields", []):
            if f["name"] == "Title":
                title = f["value"] if isinstance(f["value"], str) else ""
        USER_MAP[u["userId"]] = {
            "name": f"{u['firstName']} {u['lastName']}",
            "role": u["userType"],
            "title": title,
        }


def user_name(uid):
    return USER_MAP.get(uid, {}).get("name", f"User {uid}")


def format_ts(ts):
    return datetime.fromtimestamp(ts).strftime("%a %m/%d %I:%M%p").replace(" 0", " ")


def format_time(ts):
    return datetime.fromtimestamp(ts).strftime("%I:%M%p").lstrip("0").lower()


def format_date_short(ts):
    return datetime.fromtimestamp(ts).strftime("%a %m/%d")


def get_week_boundaries(start_date, end_date):
    weeks = []
    current = start_date - timedelta(days=start_date.weekday())
    while current < end_date:
        week_end = min(current + timedelta(days=6), end_date)
        weeks.append((current, week_end))
        current += timedelta(days=7)
    return weeks


# =============================================================================
# SCHEDULE COVERAGE REPORT
# =============================================================================

def generate_schedule_report(start_date, end_date):
    lines = []
    lines.append("# Schedule Coverage Report")
    lines.append(f"**Period:** {start_date.strftime('%B %d')} – {end_date.strftime('%B %d, %Y')}")
    lines.append(f"**Generated:** {datetime.now().strftime('%B %d, %Y at %I:%M %p')}")
    lines.append("")
    lines.append("---")
    lines.append("")

    weeks = get_week_boundaries(start_date, end_date)

    total_shifts = 0
    total_open = 0
    total_rejected = 0
    total_accepted = 0
    total_no_response = 0
    employee_shifts = defaultdict(int)
    employee_hours = defaultdict(float)

    for week_start, week_end in weeks:
        week_label = f"{week_start.strftime('%b %d')} – {week_end.strftime('%b %d, %Y')}"
        print(f"  Schedule: {week_label}...")

        start_ts = int(week_start.timestamp())
        end_ts = int(week_end.timestamp()) + 86400

        resp = api_get(
            f"scheduler/v1/schedulers/{SCHEDULER_ID}/shifts",
            {"startTime": str(start_ts), "endTime": str(end_ts)},
        )
        time.sleep(4)

        if not resp or "data" not in resp:
            continue

        shifts = resp["data"].get("shifts", [])
        week_open = []
        week_rejected = []
        week_no_response = []

        lines.append(f"## Week of {week_label}")
        lines.append("")

        for s in shifts:
            total_shifts += 1
            title = s.get("title", "Untitled")
            loc = s.get("locationData", {}).get("gps", {}).get("address", "Unknown")
            loc_short = loc.split(",")[0] if loc else "Unknown"
            start_t = format_date_short(s["startTime"])
            time_range = f"{format_time(s['startTime'])}–{format_time(s['endTime'])}"
            hours = (s["endTime"] - s["startTime"]) / 3600
            assigned = s.get("assignedUserIds", [])

            # Check status
            is_open = s.get("isOpenShift", False)
            statuses = s.get("statuses", [])

            if is_open and not assigned:
                total_open += 1
                open_spots = s.get("openSpots", 1)
                week_open.append({
                    "title": title, "date": start_t, "time": time_range,
                    "location": loc_short, "spots": open_spots,
                })
            elif statuses:
                latest = statuses[0]
                status = latest.get("status", "")
                if status == "rejected":
                    total_rejected += 1
                    who = user_name(latest.get("assignedUserId", 0))
                    note = latest.get("note", "")
                    week_rejected.append({
                        "title": title, "date": start_t, "time": time_range,
                        "employee": who, "note": note, "location": loc_short,
                    })
                elif status == "accepted":
                    total_accepted += 1
            else:
                if assigned:
                    total_no_response += 1
                    for uid in assigned:
                        week_no_response.append({
                            "title": title, "date": start_t, "time": time_range,
                            "employee": user_name(uid), "location": loc_short,
                        })

            for uid in assigned:
                employee_shifts[uid] += 1
                employee_hours[uid] += hours

        # Open shifts
        if week_open:
            lines.append("### Unfilled Open Shifts")
            lines.append("")
            lines.append("| Shift | Date | Time | Location | Open Spots |")
            lines.append("|---|---|---|---|---|")
            for o in week_open:
                lines.append(f"| {o['title']} | {o['date']} | {o['time']} | {o['location']} | {o['spots']} |")
            lines.append("")

        # Rejected
        if week_rejected:
            lines.append("### Rejected Shifts")
            lines.append("")
            lines.append("| Shift | Date | Employee | Reason | Location |")
            lines.append("|---|---|---|---|---|")
            for r in week_rejected:
                lines.append(f"| {r['title']} | {r['date']} | {r['employee']} | {r['note']} | {r['location']} |")
            lines.append("")

        # No response
        if week_no_response:
            lines.append("### No Response")
            lines.append("")
            lines.append("| Shift | Date | Employee | Location |")
            lines.append("|---|---|---|---|")
            for n in week_no_response:
                lines.append(f"| {n['title']} | {n['date']} | {n['employee']} | {n['location']} |")
            lines.append("")

        if not week_open and not week_rejected and not week_no_response:
            lines.append("All shifts covered and accepted.")
            lines.append("")

        lines.append("---")
        lines.append("")

    # Summary
    lines.append("## Coverage Summary")
    lines.append("")
    lines.append(f"| Metric | Count |")
    lines.append(f"|---|---|")
    lines.append(f"| Total scheduled shifts | {total_shifts} |")
    lines.append(f"| Accepted | {total_accepted} |")
    lines.append(f"| Rejected | {total_rejected} |")
    lines.append(f"| Unfilled open shifts | {total_open} |")
    lines.append(f"| No response | {total_no_response} |")
    lines.append("")

    # Hours per employee
    lines.append("### Scheduled Hours per Employee")
    lines.append("")
    lines.append("| Employee | Shifts | Scheduled Hours |")
    lines.append("|---|---|---|")
    for uid in sorted(employee_shifts.keys()):
        lines.append(f"| {user_name(uid)} | {employee_shifts[uid]} | {employee_hours[uid]:.1f}h |")
    lines.append("")

    return "\n".join(lines)


# =============================================================================
# ATTENDANCE REPORT
# =============================================================================

def generate_attendance_report(start_date, end_date):
    lines = []
    lines.append("# Attendance Report")
    lines.append(f"**Period:** {start_date.strftime('%B %d')} – {end_date.strftime('%B %d, %Y')}")
    lines.append(f"**Generated:** {datetime.now().strftime('%B %d, %Y at %I:%M %p')}")
    lines.append("")
    lines.append("---")
    lines.append("")

    weeks = get_week_boundaries(start_date, end_date)

    all_issues = []
    employee_stats = defaultdict(lambda: {
        "scheduled": 0, "worked": 0, "late": 0, "missed": 0,
        "scheduled_hours": 0, "actual_hours": 0,
    })

    for week_start, week_end in weeks:
        week_label = f"{week_start.strftime('%b %d')} – {week_end.strftime('%b %d, %Y')}"
        print(f"  Attendance: {week_label}...")

        start_str = week_start.strftime("%Y-%m-%d")
        end_str = week_end.strftime("%Y-%m-%d")
        start_ts = int(week_start.timestamp())
        end_ts = int(week_end.timestamp()) + 86400

        # Fetch schedule
        sched = api_get(
            f"scheduler/v1/schedulers/{SCHEDULER_ID}/shifts",
            {"startTime": str(start_ts), "endTime": str(end_ts)},
        )
        time.sleep(4)

        # Fetch time activities
        activities = api_get(
            f"time-clock/v1/time-clocks/{TIME_CLOCK_ID}/time-activities",
            {"startDate": start_str, "endDate": end_str},
        )
        time.sleep(4)

        # Index activities by user and scheduler shift ID
        clocked_shifts = {}  # schedulerShiftId -> activity
        user_activities = defaultdict(list)
        if activities and "data" in activities:
            for u in activities["data"].get("timeActivitiesByUsers", []):
                for s in u.get("shifts", []):
                    sid = s.get("schedulerShiftId")
                    if sid:
                        clocked_shifts[sid] = {
                            "userId": u["userId"],
                            "start": s["start"]["timestamp"],
                            "end": s["end"]["timestamp"],
                            "note": s.get("employeeNote", ""),
                            "end_location": s["end"].get("locationData", {}).get("address", ""),
                        }
                    user_activities[u["userId"]].append(s)

        lines.append(f"## Week of {week_label}")
        lines.append("")

        week_issues = []

        if sched and "data" in sched:
            for shift in sched["data"].get("shifts", []):
                shift_id = shift["id"]
                title = shift.get("title", "Untitled")
                loc = shift.get("locationData", {}).get("gps", {}).get("address", "Unknown")
                loc_short = loc.split(",")[0] if loc else "Unknown"
                sched_start = shift["startTime"]
                sched_end = shift["endTime"]
                sched_hours = (sched_end - sched_start) / 3600
                assigned = shift.get("assignedUserIds", [])

                for uid in assigned:
                    employee_stats[uid]["scheduled"] += 1
                    employee_stats[uid]["scheduled_hours"] += sched_hours

                    # Check if they clocked in for this shift
                    activity = clocked_shifts.get(shift_id)
                    if activity and activity["userId"] == uid:
                        employee_stats[uid]["worked"] += 1
                        actual_hours = (activity["end"] - activity["start"]) / 3600
                        employee_stats[uid]["actual_hours"] += actual_hours

                        # Late check (more than 10 min late)
                        late_mins = (activity["start"] - sched_start) / 60
                        if late_mins > 10:
                            employee_stats[uid]["late"] += 1
                            week_issues.append({
                                "type": "Late",
                                "employee": user_name(uid),
                                "shift": title,
                                "date": format_date_short(sched_start),
                                "detail": f"{late_mins:.0f} min late (scheduled {format_time(sched_start)}, clocked in {format_time(activity['start'])})",
                            })

                        # Early leave check (left more than 15 min early)
                        early_mins = (sched_end - activity["end"]) / 60
                        if early_mins > 15:
                            week_issues.append({
                                "type": "Early leave",
                                "employee": user_name(uid),
                                "shift": title,
                                "date": format_date_short(sched_start),
                                "detail": f"Left {early_mins:.0f} min early (scheduled until {format_time(sched_end)}, clocked out {format_time(activity['end'])})",
                            })

                        # Location mismatch — check if clocked out far from job
                        end_loc = activity.get("end_location", "")
                        if end_loc and loc_short != "Unknown":
                            # Simple string comparison — flag if city doesn't match
                            shift_city = loc_short.split(",")[0].strip().lower() if loc else ""
                            end_city = end_loc.split(",")[0].strip().lower() if end_loc else ""

                    else:
                        # Check if shift is in the past
                        if sched_start < datetime.now().timestamp():
                            # Check statuses — if rejected, it's not a no-show
                            statuses = shift.get("statuses", [])
                            was_rejected = any(
                                st.get("status") == "rejected" and st.get("assignedUserId") == uid
                                for st in statuses
                            )
                            if not was_rejected and not shift.get("isOpenShift", False):
                                employee_stats[uid]["missed"] += 1
                                week_issues.append({
                                    "type": "No clock-in",
                                    "employee": user_name(uid),
                                    "shift": title,
                                    "date": format_date_short(sched_start),
                                    "detail": f"Scheduled {format_time(sched_start)}–{format_time(sched_end)} at {loc_short}, no clock-in recorded",
                                })

        if week_issues:
            lines.append("| Type | Employee | Shift | Date | Detail |")
            lines.append("|---|---|---|---|---|")
            for iss in week_issues:
                lines.append(f"| **{iss['type']}** | {iss['employee']} | {iss['shift']} | {iss['date']} | {iss['detail']} |")
            lines.append("")
            all_issues.extend(week_issues)
        else:
            lines.append("No attendance issues this week.")
            lines.append("")

        lines.append("---")
        lines.append("")

    # Summary
    lines.append("## Attendance Summary")
    lines.append("")
    lines.append("| Employee | Scheduled | Worked | Late | No Clock-in | Sched Hours | Actual Hours | Diff |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for uid in sorted(employee_stats.keys()):
        s = employee_stats[uid]
        diff = s["actual_hours"] - s["scheduled_hours"]
        diff_str = f"+{diff:.1f}h" if diff >= 0 else f"{diff:.1f}h"
        lines.append(
            f"| {user_name(uid)} | {s['scheduled']} | {s['worked']} | {s['late']} | "
            f"{s['missed']} | {s['scheduled_hours']:.1f}h | {s['actual_hours']:.1f}h | {diff_str} |"
        )
    lines.append("")

    return "\n".join(lines)


# =============================================================================
# CLIENT JOB HISTORY
# =============================================================================

def generate_job_report(start_date, end_date):
    lines = []
    lines.append("# Client Job History")
    lines.append(f"**Period:** {start_date.strftime('%B %d')} – {end_date.strftime('%B %d, %Y')}")
    lines.append(f"**Generated:** {datetime.now().strftime('%B %d, %Y at %I:%M %p')}")
    lines.append("")
    lines.append("---")
    lines.append("")

    # Fetch all time activities across the period
    weeks = get_week_boundaries(start_date, end_date)

    # job location -> list of cleans
    job_cleans = defaultdict(list)

    for week_start, week_end in weeks:
        week_label = f"{week_start.strftime('%b %d')} – {week_end.strftime('%b %d, %Y')}"
        print(f"  Jobs: {week_label}...")

        start_str = week_start.strftime("%Y-%m-%d")
        end_str = week_end.strftime("%Y-%m-%d")

        activities = api_get(
            f"time-clock/v1/time-clocks/{TIME_CLOCK_ID}/time-activities",
            {"startDate": start_str, "endDate": end_str},
        )
        time.sleep(4)

        if not activities or "data" not in activities:
            continue

        for u in activities["data"].get("timeActivitiesByUsers", []):
            uid = u["userId"]
            for s in u.get("shifts", []):
                loc = s["start"].get("locationData", {}).get("address", "Unknown")
                if loc == "Unknown":
                    continue

                # Normalize address to group similar locations
                loc_key = loc.split(",")[0].strip()
                hours = (s["end"]["timestamp"] - s["start"]["timestamp"]) / 3600
                date = datetime.fromtimestamp(s["start"]["timestamp"]).strftime("%Y-%m-%d")

                job_cleans[loc_key].append({
                    "date": date,
                    "date_display": format_date_short(s["start"]["timestamp"]),
                    "employee": user_name(uid),
                    "hours": hours,
                    "note": s.get("employeeNote", "").strip(),
                    "full_address": loc,
                })

    # Sort by number of cleans (most visited first)
    sorted_jobs = sorted(job_cleans.items(), key=lambda x: len(x[1]), reverse=True)

    lines.append(f"## Summary: {len(sorted_jobs)} Locations Serviced")
    lines.append("")
    lines.append("| Location | Times Cleaned | Total Hours | Employees |")
    lines.append("|---|---|---|---|")
    for loc, cleans in sorted_jobs:
        total_hours = sum(c["hours"] for c in cleans)
        employees = sorted(set(c["employee"] for c in cleans))
        lines.append(f"| {loc} | {len(cleans)} | {total_hours:.1f}h | {', '.join(employees)} |")
    lines.append("")
    lines.append("---")
    lines.append("")

    # Detailed per-location history
    lines.append("## Detailed History")
    lines.append("")
    for loc, cleans in sorted_jobs:
        full_addr = cleans[0]["full_address"]
        lines.append(f"### {loc}")
        lines.append(f"*{full_addr}*")
        lines.append("")
        lines.append("| Date | Employee | Hours | Notes |")
        lines.append("|---|---|---|---|")
        for c in sorted(cleans, key=lambda x: x["date"]):
            note = c["note"] if c["note"] else ""
            lines.append(f"| {c['date_display']} | {c['employee']} | {c['hours']:.1f}h | {note} |")
        lines.append("")

    return "\n".join(lines)


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Connecteam Operations Dashboard")
    parser.add_argument("--report", type=str, default="all",
                        choices=["all", "schedule", "attendance", "jobs"],
                        help="Which report (default: all)")
    parser.add_argument("--weeks", type=int, default=2, help="Number of weeks (default: 2)")
    parser.add_argument("--start", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, help="End date (YYYY-MM-DD)")
    parser.add_argument("--output", type=str, default="dashboard-report.md", help="Output file")
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

    print("Fetching users...")
    fetch_users()
    time.sleep(2)

    sections = []

    if args.report in ("all", "schedule"):
        print("Generating schedule coverage report...")
        sections.append(generate_schedule_report(start_date, end_date))

    if args.report in ("all", "attendance"):
        print("Generating attendance report...")
        sections.append(generate_attendance_report(start_date, end_date))

    if args.report in ("all", "jobs"):
        print("Generating client job history...")
        sections.append(generate_job_report(start_date, end_date))

    report = "\n\n---\n\n".join(sections)

    os.makedirs(os.path.dirname(args.output) if os.path.dirname(args.output) else ".", exist_ok=True)
    with open(args.output, "w") as f:
        f.write(report)

    print(f"\nReport saved to: {args.output}")


if __name__ == "__main__":
    main()
