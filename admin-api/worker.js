// Admin API for the Marathon PB board (Cloudflare Worker).
// Checks the admin login and commits changes to data/*.csv on GitHub, which
// triggers the Pages build. Secrets: ADMIN_USER, ADMIN_PASS_HASH,
// SESSION_SECRET, GITHUB_TOKEN. Vars (wrangler.toml): REPO, BRANCH, ALLOWED_ORIGINS.

const RUNNERS = 'data/runners.csv';
const HISTORY = 'data/race-history.csv';
const SESSION_HOURS = 12;
const enc = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- auth ----------

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));

// ADMIN_PASS_HASH format: pbkdf2$<iterations>$<salt b64>$<hash b64> (made by set-password.mjs)
async function passwordOk(password, stored) {
  const [kind, iter, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2') return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: Number(iter) }, key, 256);
  return equal(new Uint8Array(bits), unb64(hash));
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

const hmacKey = (env) => crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

async function makeSession(env) {
  const exp = String(Date.now() + SESSION_HOURS * 3600e3);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode('session.' + exp));
  return exp + '.' + b64u(sig);
}

async function requireSession(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) throw new HttpError(401, 'Η σύνδεση έληξε. Συνδεθείτε ξανά.');
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(sig), enc.encode('session.' + exp)); } catch { ok = false; }
  if (!ok) throw new HttpError(401, 'Μη έγκυρη σύνδεση. Συνδεθείτε ξανά.');
}

// Wrong passwords per IP. Per isolate only, so it slows guessing rather than
// stopping it; the PBKDF2 cost and a long random password do the rest.
const failures = new Map();
const LOCK_AFTER = 5, LOCK_MS = 15 * 60e3;

async function login(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const f = failures.get(ip);
  if (f && f.count >= LOCK_AFTER && Date.now() - f.last < LOCK_MS) throw new HttpError(429, 'Πολλές αποτυχημένες προσπάθειες. Δοκιμάστε ξανά σε 15 λεπτά.');
  const { user = '', password = '' } = await body(request);
  const userOk = equal(enc.encode(String(user).trim()), enc.encode(env.ADMIN_USER || ''));
  const passOk = await passwordOk(String(password), env.ADMIN_PASS_HASH);
  if (!userOk || !passOk) {
    failures.set(ip, { count: (f && Date.now() - f.last < LOCK_MS ? f.count : 0) + 1, last: Date.now() });
    throw new HttpError(401, 'Λάθος όνομα χρήστη ή κωδικός.');
  }
  failures.delete(ip);
  return { token: await makeSession(env), hours: SESSION_HOURS };
}

// ---------- CSV (matches Python's csv module: quote only when needed) ----------

function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return { header, rows: data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))), eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

const cell = (v) => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
const toCsv = ({ header, rows, eol }) => [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))].map((r) => r.map(cell).join(',')).join(eol) + eol;

// ---------- GitHub ----------

async function gh(env, path, init = {}, retry = !init.method) {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'marathon-pb-admin',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  }).catch((e) => {
    if (retry) return null; // dropped connection on a read: try once more below
    throw e;
  });
  if (!res) return gh(env, path, init, false);
  if (!res.ok) {
    const err = new HttpError(502, `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.github = res.status;
    throw err;
  }
  return res.json();
}

async function readData(env) {
  const ref = await gh(env, `/git/ref/heads/${env.BRANCH}`);
  const head = ref.object.sha;
  const read = async (path) => {
    const f = await gh(env, `/contents/${path}?ref=${head}`);
    return parseCsv(new TextDecoder().decode(unb64(f.content.replace(/\n/g, ''))));
  };
  const [runners, history] = await Promise.all([read(RUNNERS), read(HISTORY)]);
  return { head, runners, history };
}

async function commit(env, head, files, message) {
  const base = await gh(env, `/git/commits/${head}`);
  const tree = await gh(env, '/git/trees', { method: 'POST', body: JSON.stringify({
    base_tree: base.tree.sha,
    tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
  }) });
  const c = await gh(env, '/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [head] }) });
  await gh(env, `/git/refs/heads/${env.BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
  return c.html_url;
}

// Reads fresh data, applies `change`, commits. Retries once if someone else
// committed in between (the ref update is then not a fast-forward).
async function mutate(env, change, dryRun) {
  for (let attempt = 0; ; attempt++) {
    const data = await readData(env);
    const { files, message, notes } = change(data);
    if (dryRun) return { notes };
    try {
      return { notes, commit: await commit(env, data.head, files, message) };
    } catch (e) {
      if (attempt === 0 && e.github === 422) continue;
      throw e;
    }
  }
}

// ---------- validation and domain rules ----------

const TIME = /^(\d):([0-5]\d):([0-5]\d)$/;
const sec = (t) => { const m = TIME.exec(t); return m ? m[1] * 3600 + m[2] * 60 + Number(m[3]) : null; };

function checkTime(t, label) {
  const s = sec(t);
  if (s == null || s < 2 * 3600 || s >= 8 * 3600) throw new HttpError(400, `${label}: γράψτε τον χρόνο ως ω:λλ:δδ, π.χ. 2:59:41.`);
}

function checkDate(d) {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
  if (!ok) throw new HttpError(400, 'Μη έγκυρη ημερομηνία.');
  if (new Date(d) > new Date(Date.now() + 864e5)) throw new HttpError(400, 'Η ημερομηνία είναι στο μέλλον.');
  if (d < '1980-01-01') throw new HttpError(400, 'Η ημερομηνία είναι πολύ παλιά.');
}

function checkText(v, label, max = 60) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\r\n]/.test(v)) throw new HttpError(400, `${label}: λείπει ή δεν είναι έγκυρο.`);
  return v.trim();
}

const findRunner = (runners, rank) => {
  const r = runners.rows.find((x) => x.rank === String(rank));
  if (!r) throw new HttpError(404, 'Ο αθλητής δεν βρέθηκε.');
  return r;
};
const fullName = (r) => r.surname + ' ' + r.name;

function addRace(input) {
  const race = checkText(input.race, 'Αγώνας');
  const date = String(input.date || ''); checkDate(date);
  const time = String(input.time || '').trim(); checkTime(time, 'Χρόνος');
  const authentic = input.authentic === true;
  const note = String(input.notes ?? '').trim();
  if (note.length > 300 || /[\r\n]/.test(note)) throw new HttpError(400, 'Σχόλια / σύνδεσμος: μία γραμμή, έως 300 χαρακτήρες.');
  if (/^https?:/i.test(note)) { // same test the pages use to show it as a link
    let ok = /^https?:\/\/\S+$/i.test(note);
    try { new URL(note); } catch { ok = false; }
    if (!ok) throw new HttpError(400, 'Ο σύνδεσμος δεν είναι έγκυρος.');
  }
  return ({ runners, history }) => {
    const r = findRunner(runners, input.rank);
    if (history.rows.some((h) => h.rank === r.rank && h.date === date)) throw new HttpError(409, `Υπάρχει ήδη αγώνας για ${fullName(r)} στις ${date}.`);
    if (!history.header.includes('notes')) history.header.push('notes');
    const row = { rank: r.rank, runner: fullName(r), race, date, time, authentic: authentic ? 'yes' : 'no', notes: note };
    // keep each runner's races together and in date order
    const mine = history.rows.map((h, i) => [h, i]).filter(([h]) => h.rank === r.rank);
    const after = mine.filter(([h]) => h.date <= date).pop() || null;
    const at = after ? after[1] + 1 : mine.length ? mine[0][1] : history.rows.length;
    history.rows.splice(at, 0, row);

    const notes = [`Νέος αγώνας: ${race}, ${date}, ${time}${authentic ? ' (Αυθεντικός)' : ''}.`];
    if (note) notes.push(`Σχόλια / σύνδεσμος: ${note}`);
    if (!r.pb || sec(time) < sec(r.pb)) {
      notes.push(`Νέο ατομικό ρεκόρ: ${r.pb || '—'} → ${time} (${race} ${date.slice(0, 4)}).`);
      Object.assign(r, { pb: time, pbYear: date.slice(0, 4), pbPlace: race });
    } else notes.push(`Το ατομικό ρεκόρ ${r.pb} δεν αλλάζει.`);
    if (authentic) {
      if (!r.authenticBest || sec(time) < sec(r.authenticBest)) {
        notes.push(`Νέο καλύτερο στον Αυθεντικό: ${r.authenticBest || '—'} → ${time}.`);
        r.authenticBest = time;
      } else notes.push(`Το καλύτερο στον Αυθεντικό ${r.authenticBest} δεν αλλάζει.`);
    }
    return {
      files: { [HISTORY]: toCsv(history), [RUNNERS]: toCsv(runners) },
      message: `Νέος αγώνας: ${fullName(r)}, ${race} ${date} ${time} (admin)`,
      notes,
    };
  };
}

const LABELS = { surname: 'Επώνυμο', name: 'Όνομα', gender: 'Φύλο', birthYear: 'Έτος γέννησης', pb: 'Ατομικό ρεκόρ', pbYear: 'Έτος ρεκόρ', pbPlace: 'Τόπος ρεκόρ', authenticBest: 'Καλύτερο στον Αυθεντικό' };

function editRunner(input) {
  const f = input.fields || {};
  const next = {};
  for (const k of Object.keys(f)) {
    if (!(k in LABELS)) throw new HttpError(400, `Άγνωστο πεδίο: ${k}`);
    next[k] = String(f[k] ?? '').trim();
  }
  for (const k of ['surname', 'name', 'pbPlace']) if (k in next) checkText(next[k], LABELS[k]);
  if ('gender' in next && !['Α', 'Γ'].includes(next.gender)) throw new HttpError(400, 'Φύλο: Α ή Γ.');
  for (const k of ['birthYear', 'pbYear']) {
    if (k in next && next[k] && !(/^\d{4}$/.test(next[k]) && next[k] >= '1930' && next[k] <= String(new Date().getUTCFullYear()))) throw new HttpError(400, `${LABELS[k]}: μη έγκυρο έτος.`);
  }
  if ('pb' in next) checkTime(next.pb, LABELS.pb);
  if ('authenticBest' in next && next.authenticBest) checkTime(next.authenticBest, LABELS.authenticBest);
  return ({ runners, history }) => {
    const r = findRunner(runners, input.rank);
    const oldName = fullName(r);
    const notes = [];
    for (const [k, v] of Object.entries(next)) if (r[k] !== v) { notes.push(`${LABELS[k]}: ${r[k] || '—'} → ${v || '—'}`); r[k] = v; }
    if (!notes.length) throw new HttpError(400, 'Δεν άλλαξε τίποτα.');
    const files = { [RUNNERS]: toCsv(runners) };
    if (fullName(r) !== oldName) {
      for (const h of history.rows) if (h.rank === r.rank) h.runner = fullName(r);
      files[HISTORY] = toCsv(history);
    }
    return { files, message: `Στοιχεία αθλητή: ${fullName(r)} (admin)`, notes };
  };
}

// ---------- routing ----------

async function body(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Μη έγκυρο αίτημα.'); }
}

async function route(request, env) {
  const { pathname } = new URL(request.url);
  if (request.method === 'POST' && pathname === '/login') return login(request, env);
  await requireSession(request, env);
  if (request.method === 'GET' && pathname === '/data') {
    const { runners, history } = await readData(env);
    return { runners: runners.rows, history: history.rows };
  }
  if (request.method === 'POST' && pathname === '/race') { const b = await body(request); return mutate(env, addRace(b), b.dryRun === true); }
  if (request.method === 'POST' && pathname === '/runner') { const b = await body(request); return mutate(env, editRunner(b), b.dryRun === true); }
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
    const cors = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' }
      : {};
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let status = 200, out;
    try { out = await route(request, env); }
    catch (e) {
      status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) console.error(e);
      const ghMsg = e.github === 401 ? 'Το κλειδί GitHub έληξε ή ανακλήθηκε. Ο διαχειριστής πρέπει να βάλει νέο (GITHUB_TOKEN).'
        : e.github === 403 || e.github === 404 ? 'Το κλειδί GitHub δεν έχει δικαίωμα εγγραφής (Contents: Read and write) σε αυτό το αποθετήριο.'
        : 'Αποτυχία επικοινωνίας με το GitHub. Δοκιμάστε ξανά.';
      out = { error: status === 502 ? ghMsg : e instanceof HttpError ? e.message : 'Σφάλμα διακομιστή.' };
    }
    return new Response(JSON.stringify(out), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
  },
};

export { parseCsv, toCsv, addRace, editRunner }; // for test.mjs
