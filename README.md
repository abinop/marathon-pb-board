# Marathon PB board 2026

A one-page dashboard of the coach's list of marathon personal bests: ranking, Athens Authentic adjustment (Authentic time − 5:30 ≈ flat-course equivalent), men/women filter, birth-decade colours, race-by-race history, age at PB and more.

## Updating the data

**Admin page** (`/admin.html` on the site, login required): pick an athlete, then add a new race (city, date, finish time, Athens Authentic or not) or edit their details. A faster race updates the athlete's PB automatically. Each save is a commit to this repo, and the site updates 1–2 minutes later.

**By hand:** edit the CSVs below and push to `main`. The GitHub Action runs `build.py` and publishes. For a local preview, run `python3 build.py` and `python3 -m http.server 8000`.

### `data/runners.csv`
| column | meaning |
|---|---|
| rank | the coach's list position (used as the runner's id) |
| surname, name | |
| gender | `Α` man, `Γ` woman |
| birthYear | blank if unknown |
| pbYear, pb, pbPlace | personal best: year, time `h:mm:ss`, city |
| authenticBest | best Athens Authentic time, blank if none |

### `data/race-history.csv`
`rank` must match a runner's `rank` in `runners.csv`. `authentic` is `yes` for Athens races.

## Files
- `src/admin.html` — the admin page
- `admin-api/` — the Cloudflare Worker that checks the admin login and commits the changes
- `.github/workflows/pages.yml` — builds and publishes the site on every push to `main`
- `src/dashboard.html` — the dashboard's markup, styles and charts
- `build.py` — builds `index.html` and `admin.html` (not committed) from `src/` and the data
