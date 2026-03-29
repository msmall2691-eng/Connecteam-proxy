# Connecteam Proxy & Reports

## Quick Commands

### Generate a weekly report
```bash
python3 report.py                                    # Last 4 weeks
python3 report.py --weeks 2                          # Last 2 weeks
python3 report.py --weeks 8 --output reports/feb.md  # Last 8 weeks, custom file
python3 report.py --start 2026-01-01 --end 2026-03-29  # Custom date range
```

### API proxy
The Vercel proxy is at: `https://connecteam-proxy.vercel.app/api/connecteam`

Example endpoints (pass as `?path=`):
- `users/v1/users` — all employees
- `me` — company info
- `time-clock/v1/time-clocks/15248536/timesheet?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — timesheets
- `time-clock/v1/time-clocks/15248536/time-activities?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — clock in/out with mileage
- `scheduler/v1/schedulers/15248539/shifts?startTime=UNIX&endTime=UNIX` — schedule
- `jobs/v1/jobs` — job locations
- `forms/v1/forms` — forms
- `tasks/v1/taskboards/15248544/tasks` — tasks

### API Key
Set via environment variable: `CONNECTEAM_API_KEY`
Or pass directly: `python3 report.py --api-key YOUR_KEY`

## Notes
- Connecteam API rate limits to ~5 requests per 10 seconds
- Time clock ID: 15248536
- Scheduler ID: 15248539
- Mileage is stored in `shiftAttachments[].attachment.number` on time activities
