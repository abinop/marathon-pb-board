# Marathon PB board

A static, single-page dashboard of a running coach's list of marathon personal bests (Greek runners, 2026). Hosted on GitHub Pages from `main` / root.

## How it's built
- `data/runners.csv`: one row per runner. `rank` is the coach's list position and is the runner's id everywhere. `gender` is Greek: `Α` = man, `Γ` = woman. Times are `h:mm:ss`. Blank `birthYear`, `pbYear` or `authenticBest` means unknown or none.
- `data/race-history.csv`: one row per race, from the coach's older sheet (covers only 16 runners, up to spring 2024). `rank` joins to runners.csv. `authentic` = `yes` for Athens races.
- `src/dashboard.html`: markup, CSS and chart code (d3 v7). It is written against a small `dash` API (`dash.data`, `dash.calc`, `dash.onData`, `dash.params`, `dash.setParams`, `dash.colors`) so the same file also runs in the Claude dashboard version.
- `build.py`: wraps `src/dashboard.html` in a full HTML page, inlines both CSVs as JSON, adds a minimal `dash` shim, CSS tokens (light + dark) and d3 from cdnjs, and writes `index.html`. It also writes `admin.html` from `src/admin.html`, injecting the `CITY` map from the dashboard and the Worker URL (`ADMIN_API`). Standard library only.
- `index.html` and `admin.html` are generated and gitignored. `.github/workflows/pages.yml` runs `build.py` on every push to `main` and publishes both to Pages (Pages source = GitHub Actions).
- `admin-api/`: Cloudflare Worker behind the admin page. One shared login (secrets `ADMIN_USER`, `ADMIN_PASS_HASH`, `SESSION_SECRET`), 12-hour sessions. It edits the CSVs and commits to `main` with a fine-grained GitHub token (`GITHUB_TOKEN` secret, contents: write on this repo only). That push triggers the Pages workflow. Adding a race appends it to race-history.csv and updates `pb`/`pbYear`/`pbPlace` and `authenticBest` in runners.csv when faster.
- New admin password: `cd admin-api && node set-password.mjs`. Deploy: `npx wrangler@4 deploy`. Offline tests: `node admin-api/test.mjs`.

## Run / preview
```
python3 build.py
python3 -m http.server 8000   # then open http://localhost:8000
# admin page against a local Worker (admin-api/.dev.vars holds test secrets; point BRANCH at a throwaway branch):
cd admin-api && npx wrangler@4 dev --port 8787   # admin.html on localhost talks to :8787
```

## Domain rules
- The Athens Authentic marathon is much harder than a flat course: Authentic time minus 5:30 (the coach says 5-6 min) ≈ flat-course equivalent. `ADJUST = 330` seconds inside the `enriched` calc in src/dashboard.html.
- With the adjustment on, each runner is ranked by min(flat PB, Authentic − 5:30). "Move" = places gained versus the raw PB ranking, overall or within gender.
- Birth decades are coloured 1960s / 1970s / 1980s / 1990s / Unknown.

## Data notes
- Cleaned from the coach's sheets: names trimmed, "Tokio" → Tokyo, Λαμπρούλης and Αναστάσης set to men (gender was blank), Καπέλης Γιάννης changed from Γ to Α. In the history, three typo dates were fixed (21/40/2024, 29/10.2023, 28/94/2024).
- 24 runners still have no birth year. A web search found nothing; ask the coach.
- The source spreadsheet's AgeOfPb column was unreliable (Μπαλαφούτης had 2019), so age is computed as pbYear − birthYear.
- Source sheets (Google Sheets, the owner's): current list 1twxJAHDrSFIMHIZ3QkYEYN6_yHFdKQBghe6SB8eqf0s; older version with per-runner race tabs 1l_o2LVxqNvtmNu0Q7nimYdHWFOZCOVVTPaNlyQrJj4w.

## Ideas not built yet
- Age grading (WMA age-graded %) for a fair comparison across ages and sexes
- Separate men's and women's top-10 side by side
- Number of marathons vs improvement, from the race history
- A slider for the Authentic adjustment instead of a fixed 5:30
- Privacy option: initials only or hide birth years, since the Pages repo is public

## Conventions
- Keep it a static site: no bundler, no npm. d3 is the only dependency.
- UI text is Greek (`<html lang="el">`). City names are kept in English in the CSVs and shown in Greek through the `CITY` map in src/dashboard.html; add new cities there.
- Check the page in both light and dark mode, and at phone width (~400px).
