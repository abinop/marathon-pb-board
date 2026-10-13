# Marathon PB board 2026

A one-page dashboard of the coach's list of marathon personal bests: ranking, Athens Authentic adjustment (Authentic time − 5:30 ≈ flat-course equivalent), men/women filter, birth-decade colours, race-by-race history, age at PB and more.

## Updating the data

1. Edit `data/runners.csv` (one row per runner) or `data/race-history.csv` (one row per race).
2. Run `python3 build.py` — it writes `index.html` with the data built in.
3. Commit and push; GitHub Pages republishes automatically.

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
- `index.html` — the built page (what GitHub Pages serves)
- `src/dashboard.html` — the dashboard's markup, styles and charts
- `build.py` — combines the two above with the data
