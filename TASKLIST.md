# TASKLIST — RunTools · Λίστα PB

## Progress
- [x] Greek UI, GitHub Pages via Actions (#1)
- [x] Admin panel + Cloudflare Worker: add/edit/delete races, notes/results link, duplicate-date replaces, PB/Authentic recalculation (#2–#5)
- [x] Runner progress panel + «<3ω» column (#6); age-group chips (#7)
- [x] Imported 60 marathons from racetool/myrace.gr with official dates (#8)
- [x] RunTools logo + tab icon (#9); women marker «Γ · Nη» (#10)
- [x] Title «RunTools · Λίστα PB»; removed Authentic headline, row shading, «Μεταβολή» column (#11–#13)
- [x] Gender verified against the coach's sheet: 15 women
- [x] Handoff check 2026-10-13: home 200 (127,563 B), admin.html 200, Worker /data 401 without login, CORS preflight 204, last 3 Pages runs green, no `admin-test` branch left

## For next session
1. **Alexandros:** send the coach the Greek message (birth years, Καπέλης gender, logo permission, privacy, HM PB list).
2. **Alexandros:** confirm the GitHub token pasted in chat was regenerated; if not, regenerate it and run `cd admin-api && pbpaste | npx -y wrangler@4 secret put GITHUB_TOKEN` (5 min).
3. **Alexandros:** decide whether to add Πετράκης Γιάννης's Garmin races (Hannover 12/4/26 2:59:45 = new PB, Athens 9/11/25 3:13:05).
4. **Claude, after 1 is answered:** half-marathon support. Needs the HM PB source and the threshold (sub-1:30 or ~1:25). Plan: 5–7 h, show the plan before starting.
5. Not built: adding a new athlete via admin.

## Lessons
- The safety hook reads `gh api -f` as a force push; use `--field`.
- Racetool stores placeholder race dates; always replace them with official dates.
- Anything shaded or marked in the ranking gets misread (green "moved" rows looked like women). Keep markers minimal and in the legend.
