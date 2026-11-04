// 轻量自检：node scripts/test.mjs （无依赖）。先运行 node scripts/build.mjs 生成 dist/ics。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { laLocalToUtcMs, buildEventIcs, buildOnsaleIcs, eventOutlookLinks, addMinutesLocal, displayDate } from '../public/js/calendar.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iso = ms => new Date(ms).toISOString();

// 1) 时区换算（PST / PDT / 夏令时切换日）
assert.equal(iso(laLocalToUtcMs('2026-11-17T20:00')), '2026-11-18T04:00:00.000Z');   // PST = UTC-8
assert.equal(iso(laLocalToUtcMs('2026-05-20T11:00')), '2026-05-20T18:00:00.000Z');   // PDT = UTC-7
assert.equal(iso(laLocalToUtcMs('2026-03-08T12:00')), '2026-03-08T19:00:00.000Z');   // 夏令时开始当天中午已是 PDT
assert.equal(iso(laLocalToUtcMs('2026-11-01T12:00')), '2026-11-01T20:00:00.000Z');   // 夏令时结束当天中午已是 PST
assert.equal(addMinutesLocal('2026-11-17T23:30', 60), '2026-11-18T00:30');
assert.equal(displayDate('2026-11-15T19:30'), '11/15 周日 · 19:30');

// 2) ics 解析
function parseIcs(text) {
  assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text), '必须使用 CRLF');
  const lines = text.split('\r\n'); assert.equal(lines.pop(), '');
  const unfolded = [];
  for (const l of lines) {
    assert.ok(new TextEncoder().encode(l).length <= 75, '行过长: ' + l);
    if (l.startsWith(' ')) unfolded[unfolded.length - 1] += l.slice(1); else unfolded.push(l);
  }
  const root = { children: [] }; const stack = [root];
  for (const l of unfolded) {
    if (l.startsWith('BEGIN:')) { const n = { type: l.slice(6), props: [], children: [] }; stack.at(-1).children.push(n); stack.push(n); }
    else if (l.startsWith('END:')) { const n = stack.pop(); assert.equal(n.type, l.slice(4)); }
    else { const i = l.indexOf(':'); const [name, ...params] = l.slice(0, i).split(';'); stack.at(-1).props.push({ name, params: Object.fromEntries(params.map(p => p.split('='))), value: l.slice(i + 1) }); }
  }
  assert.equal(stack.length, 1, 'BEGIN/END 不匹配');
  return root.children[0];
}
const get = (n, name) => n.props.find(p => p.name === name);
const unesc = s => s.replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
const toUtcMs = (p) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(p.value); assert.equal(p.params.TZID, 'America/Los_Angeles'); return laLocalToUtcMs(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`); };

const tours = JSON.parse(readFileSync(join(root, 'data/tours.json'), 'utf8'));
for (const ev of tours.upcoming) {
  const cal = parseIcs(readFileSync(join(root, 'dist/ics', ev.id + '.ics'), 'utf8'));
  assert.equal(cal.type, 'VCALENDAR'); assert.equal(get(cal, 'VERSION').value, '2.0');
  assert.ok(cal.children.some(c => c.type === 'VTIMEZONE'));
  const vev = cal.children.find(c => c.type === 'VEVENT');
  assert.equal(toUtcMs(get(vev, 'DTSTART')), laLocalToUtcMs(ev.start));
  assert.equal(toUtcMs(get(vev, 'DTEND')) - toUtcMs(get(vev, 'DTSTART')), (ev.durationMinutes || 180) * 60000);
  assert.ok(unesc(get(vev, 'LOCATION').value).startsWith(ev.venue.name));
  assert.ok(unesc(get(vev, 'DESCRIPTION').value).includes(ev.ticketUrl), '描述里要有购票链接');
  assert.equal(get(vev, 'UID').value, ev.id + '@yidan-kpop-tracker');
  const links = eventOutlookLinks(ev);
  for (const [k, host] of [['personal', 'outlook.live.com'], ['work', 'outlook.office.com']]) {
    const u = new URL(links[k]); assert.equal(u.host, host); assert.equal(u.pathname, '/calendar/0/deeplink/compose');
    assert.equal(u.searchParams.get('path'), '/calendar/action/compose'); assert.equal(u.searchParams.get('rru'), 'addevent');
    assert.equal(new Date(u.searchParams.get('startdt')).getTime(), laLocalToUtcMs(ev.start));
    assert.equal(u.searchParams.get('subject'), `${ev.artist} · ${ev.title}`);
    assert.ok(u.searchParams.get('body').includes(ev.ticketUrl)); assert.ok(u.searchParams.get('location').includes(ev.venue.name));
  }
}
// 3) 开票提醒（用夹具；线上数据只有真实核实过的时间）
const fixture = { id: 'demo-20270101', artist: 'DEMO', title: '测试巡演', start: '2027-01-20T20:00', venue: { name: 'Showbox SoDo', address: '1700 1st Ave S, Seattle, WA 98134' },
  onsale: { presale: { label: '会员预售', start: '2026-12-10T10:00', url: 'https://example.com/presale' }, general: { start: '2026-12-12T10:00', url: 'https://example.com/g' } } };
for (const [kind, sale] of Object.entries(fixture.onsale)) {
  const cal = parseIcs(buildOnsaleIcs(fixture, kind, Date.UTC(2026, 10, 3)));
  const vev = cal.children.find(c => c.type === 'VEVENT');
  assert.equal(toUtcMs(get(vev, 'DTSTART')), laLocalToUtcMs(sale.start));
  const alarms = vev.children.filter(c => c.type === 'VALARM');
  assert.deepEqual(alarms.map(a => get(a, 'TRIGGER').value).sort(), ['-P1D', '-PT30M']);
  alarms.forEach(a => assert.equal(get(a, 'ACTION').value, 'DISPLAY'));
  assert.ok(unesc(get(vev, 'DESCRIPTION').value).includes(sale.url));
}
assert.throws(() => buildOnsaleIcs({ ...fixture, onsale: { general: { url: 'x' } } }, 'general'), /没有可核实/);   // 没有时间 → 不生成
// 4) 真实数据：onsale.start 必须是已核实的，且有对应 ics
const files = new Set(readdirSync(join(root, 'dist/ics')));
for (const ev of tours.upcoming) for (const k of ['presale', 'general']) {
  const s = ev.onsale?.[k]; if (s?.start) { assert.ok(files.has(`${ev.id}-onsale-${k}.ics`)); assert.ok(s.url, '有开票时间必须带官方链接'); }
}
console.log('ok — 全部检查通过');
