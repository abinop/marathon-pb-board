#!/usr/bin/env python3
"""Builds index.html (from src/dashboard.html and the CSV files in data/) and
admin.html (from src/admin.html). Run: python3 build.py"""
import base64, csv, json, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parent
read = lambda name: list(csv.DictReader(open(ROOT / 'data' / name, encoding='utf-8')))
page = (ROOT / 'src' / 'dashboard.html').read_text(encoding='utf-8')
ADMIN_API = 'https://marathon-pb-admin.abinop.workers.dev'  # the Cloudflare Worker in admin-api/
runners = read('runners.csv')
history = read('race-history.csv')
data = json.dumps({'runners': runners, 'history': history}, ensure_ascii=False).replace('</', '<\\/')
head = '''<!doctype html>
<html lang="el">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<link rel="icon" type="image/svg+xml" href="__ICON__">
<style>
:root {
  --font-anthropic-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-anthropic-serif: Georgia, "Times New Roman", serif;
  --color-fg: #1f1e1c; --color-fg-muted: #6b6862; --color-bg: #faf9f6; --color-panel: #ffffff;
  --color-border-line: #e4e1da; --color-ok: #2f7d4f; --color-warn: #a86a12; --color-bad: #c2412d; --color-women: #b83280;
  --cds-chart-grid: #ece9e2; --cds-chart-axis: #c9c5bc; --cds-chart-muted: #c4c0b7; --cds-chart-reference: #9c978d;
  --cds-surface-popover: #ffffff; --cds-border: #e4e1da; --cds-shadow-popover: 0 4px 16px rgba(0,0,0,.12); --cds-text-secondary: #6b6862;
  --c1: #3266ad; --c2: #d97a2b; --c3: #2f9e7a; --c4: #9b4fb3;
  --cds-font-size-caption: 12.5px; --cds-font-size-body: 15px; --cds-font-size-heading: 16px; --cds-font-size-title: 30px;
  --cds-font-weight-medium: 600;
  --cds-gap-xs: 4px; --cds-gap-sm: 8px; --cds-gap-md: 14px; --cds-gap-lg: 22px;
  --cds-pad-xs: 5px; --cds-pad-sm: 8px; --cds-pad-md: 12px; --cds-pad-lg: 18px;
  --cds-radius: 10px; --cds-dur-slow: .3s;
}
@media (prefers-color-scheme: dark) { :root {
  --color-fg: #ecebe7; --color-fg-muted: #a19d95; --color-bg: #1c1b19; --color-panel: #252421;
  --color-border-line: #3a3833; --color-ok: #6cc28f; --color-warn: #e8b05c; --color-bad: #ee7a66; --color-women: #f08cc0;
  --cds-chart-grid: #33312d; --cds-chart-axis: #55524b; --cds-chart-muted: #5d5a53;
  --cds-surface-popover: #2c2b27; --cds-border: #44413b; --cds-shadow-popover: 0 4px 16px rgba(0,0,0,.5); --cds-text-secondary: #a19d95;
  --c1: #6b9be0; --c2: #f0a160; --c3: #5cc8a3; --c4: #c587d8;
} }
* { box-sizing: border-box; }
body { margin: 0; background: var(--color-bg); color: var(--color-fg); font-family: var(--font-anthropic-sans); }
#dash-root { max-width: 1200px; margin: 0 auto; padding: 28px clamp(16px, 4vw, 40px) 48px; }
.dash-skeleton:empty { display: block; min-height: 1em; background: var(--color-border-line); border-radius: 6px; }
.rb-footer { margin-top: 32px; font-size: 12px; color: var(--color-fg-muted); }
.rb-adminlink { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
.rb-logo { display: block; flex: none; height: 72px; border-radius: 10px; overflow: hidden; background: #000; line-height: 0; }
.rb-logo svg { height: 100%; width: auto; }
@media (max-width: 640px) { .rb-logo { height: 56px; } }
.rb-adminlink a { font-size: 12.5px; color: var(--color-fg-muted); text-decoration: none; border: 1px solid var(--color-border-line); border-radius: 999px; padding: 3px 10px; }
.rb-adminlink a:hover { color: var(--color-fg); border-color: var(--color-fg-muted); }
</style>
'''
DASH_HEAD = '''<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script>
window.dash = (() => {
  const raw = __DATA__;
  const calcs = {}, cache = {}, fns = [];
  const defaults = { gender: 'all', adjust: true };
  let params = { ...defaults };
  const get = (id) => {
    if (id in cache) return cache[id];
    if (id in raw) return (cache[id] = raw[id]);
    const c = calcs[id];
    if (!c) throw new Error('Unknown source ' + id);
    return (cache[id] = c.fn(...c.inputs.map(get)));
  };
  const run = () => fns.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(run, 120); });
  return {
    colors: ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'],
    calc: (id, o) => { calcs[id] = o; },
    loader: () => {},
    data: (id) => { try { const d = get(id); return { status: 'ok', data: d, columns: Array.isArray(d) && d[0] ? Object.keys(d[0]) : [], meta: [] }; } catch (e) { console.error(e); return { status: 'error', data: [] }; } },
    onData: (fn) => { fns.push(fn); try { fn(); } catch (e) { console.error(e); } },
    params: () => ({ ...params }),
    setParams: (p) => { params = { ...params, ...p }; run(); },
    resetParams: () => { params = { ...defaults }; run(); },
    setLink: () => {}, refresh: () => {},
  };
})();
</script>
'''.replace('__DATA__', data)
FOOTER = '''
<p class="rb-footer">Οι χρόνοι του Αυθεντικού μετατρέπονται σε ισοδύναμους επίπεδης διαδρομής αφαιρώντας 5:30. Δεδομένα: η λίστα ρεκόρ 2026 του προπονητή και το παλαιότερο φύλλο ιστορικού αγώνων.</p>
'''

def write(name, title, extra_head, body):
    html = head.replace('__TITLE__', title) + extra_head + '</head>\n<body>\n<div id="dash-root">\n' + body + '\n</div>\n</body>\n</html>\n'
    (ROOT / name).write_text(html, encoding='utf-8')
    print('Wrote', ROOT / name)

# RunTools logo (src/runtools-logo.svg) on a black tile, as designed; the runners alone are the tab icon.
LOGO = (ROOT / 'src' / 'runtools-logo.svg').read_text(encoding='utf-8').strip()
ICON = 'data:image/svg+xml;base64,' + base64.b64encode((ROOT / 'src' / 'runtools-icon.svg').read_bytes()).decode()
head = head.replace('__ICON__', ICON)
def logo_tile(height=''):
    style = ' style="height:' + height + '"' if height else ''
    return '<span class="rb-logo"' + style + '>' + LOGO + '</span>'
ADMIN_LINK = '<div class="rb-adminlink">' + logo_tile() + '<a href="admin.html" target="_blank" rel="noopener">Διαχείριση ↗</a></div>\n'
write('index.html', 'RunTools · Λίστα PB · Μαραθώνιος', DASH_HEAD, ADMIN_LINK + page + FOOTER)

# The admin page shares the dashboard's city names (Greek display <-> English key in the CSVs).
city = re.search(r'const CITY = (\{.*?\n\});', page, re.S).group(1)
# ...and the runner progress chart, between the <runner-detail> markers.
detail = re.search(r'// <runner-detail>.*?// </runner-detail>', page, re.S).group(0)
admin = (ROOT / 'src' / 'admin.html').read_text(encoding='utf-8').replace('__CITY__', city).replace('__RUNNER_DETAIL__', detail).replace('__ADMIN_API__', ADMIN_API).replace('__LOGO__', logo_tile('48px'))
write('admin.html', 'Διαχείριση · RunTools · Λίστα PB', '<meta name="robots" content="noindex">\n<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>\n', admin)
