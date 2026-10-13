// Offline checks for the CSV handling and the race/athlete rules. Run: node admin-api/test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseCsv, toCsv, addRace, editRunner } from './worker.js';

const load = (f) => parseCsv(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
for (const f of ['runners.csv', 'race-history.csv']) {
  assert.equal(toCsv(load(f)), readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'), f + ' round-trips');
}
const fresh = () => ({ runners: load('runners.csv'), history: load('race-history.csv') });
const r9 = fresh().runners.rows.find((r) => r.rank === '9');
const throwsStatus = (fn, status) => assert.throws(fn, (e) => e.status === status);

// faster race: new PB, inserted in date order among the runner's races
let d = fresh(); let out = addRace({ rank: '9', race: 'Valencia', date: '2025-12-07', time: '2:40:00' })(d);
let me = d.runners.rows.find((r) => r.rank === '9');
assert.deepEqual([me.pb, me.pbYear, me.pbPlace], ['2:40:00', '2025', 'Valencia']);
const mine = d.history.rows.filter((h) => h.rank === '9').map((h) => h.date);
assert.deepEqual(mine, [...mine].sort()); assert.ok(mine.includes('2025-12-07'));
console.log(out.notes);

// slower Authentic: PB stays, authenticBest improves only if faster
d = fresh(); out = addRace({ rank: '9', race: 'Athens', date: '2025-11-09', time: '3:05:00', authentic: true })(d);
me = d.runners.rows.find((r) => r.rank === '9');
assert.equal(me.pb, r9.pb); assert.equal(me.authenticBest, r9.authenticBest && r9.authenticBest < '3:05:00' ? r9.authenticBest : '3:05:00');
console.log(out.notes);

// runner with no history rows: appended at end
d = fresh(); const noHist = d.runners.rows.find((r) => !d.history.rows.some((h) => h.rank === r.rank));
addRace({ rank: noHist.rank, race: 'Θεσσαλονίκη', date: '2026-04-05', time: '3:30:00' })(d);
assert.equal(d.history.rows.at(-1).rank, noHist.rank);

// rejects
throwsStatus(() => addRace({ rank: '9', race: 'X', date: '2026-02-30', time: '3:00:00' }), 400);
throwsStatus(() => addRace({ rank: '9', race: 'X', date: '2026-01-01', time: '3:0:00' }), 400);
throwsStatus(() => addRace({ rank: '9', race: 'X', date: '2099-01-01', time: '3:00:00' }), 400);
throwsStatus(() => addRace({ rank: '999', race: 'X', date: '2026-01-01', time: '3:00:00' })(fresh()), 404);
d = fresh(); const h0 = d.history.rows[0];
throwsStatus(() => addRace({ rank: h0.rank, race: 'X', date: h0.date, time: '3:00:00' })(d), 409);

// edit: name change follows into history; no-op rejected; bad gender rejected
d = fresh(); out = editRunner({ rank: h0.rank, fields: { name: 'Τεστ', birthYear: '1980' } })(d);
assert.ok(d.history.rows.filter((h) => h.rank === h0.rank).every((h) => h.runner.endsWith(' Τεστ')));
assert.ok('data/race-history.csv' in out.files); console.log(out.notes);
throwsStatus(() => editRunner({ rank: '9', fields: { pb: r9.pb } })(fresh()), 400);
throwsStatus(() => editRunner({ rank: '9', fields: { gender: 'M' } }), 400);
throwsStatus(() => editRunner({ rank: '9', fields: { evil: 'x' } }), 400);
console.log('all tests passed');

// notes: stored on the race row, bad links rejected
d = fresh(); out = addRace({ rank: '9', race: 'Munich', date: '2026-10-11', time: '2:59:00', notes: 'https://example.com/results?id=1' })(d);
assert.equal(d.history.rows.find((h) => h.date === '2026-10-11').notes, 'https://example.com/results?id=1');
assert.ok(toCsv(d.history).includes(',https://example.com/results?id=1\r\n'));
throwsStatus(() => addRace({ rank: '9', race: 'X', date: '2026-01-01', time: '3:00:00', notes: 'http://' }), 400);
throwsStatus(() => addRace({ rank: '9', race: 'X', date: '2026-01-01', time: '3:00:00', notes: 'a\nb' }), 400);
console.log('notes tests passed');
