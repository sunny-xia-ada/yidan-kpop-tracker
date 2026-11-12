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

// 5) 偶像衣橱：类别、来源链接、外链图片（不转存）、视频 id、本地图存在
import { existsSync } from 'node:fs';
const closet = JSON.parse(readFileSync(join(root, 'data/closet.json'), 'utf8'));
const CATS = new Set(['stage', 'mv', 'magazine', 'blogger']);
const httpsUrl = (u) => { const x = new URL(u); assert.equal(x.protocol, 'https:', '必须是 https 链接: ' + u); return x; };
const imgOk = (src) => { if (/^https?:/.test(src)) httpsUrl(src); else assert.ok(existsSync(join(root, 'public', src)), '本地图片不存在: ' + src); };
const seen = new Set();
assert.match(closet.lastUpdated, /^\d{4}-\d{2}-\d{2}$/);
for (const c of closet.cards) {
  assert.ok(c.id && !seen.has(c.id), '衣橱卡片 id 重复或缺失: ' + c.id); seen.add(c.id);
  assert.ok(CATS.has(c.category), '未知类别: ' + c.category);
  assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(c.styles) && c.styles.length, '缺 styles');
  if (c.category === 'magazine' || c.category === 'blogger') assert.ok(c.styles.includes(c.category), '类别要能被筛选按钮选中: ' + c.id);
  assert.ok(c.link && httpsUrl(c.link.url), '缺原始来源链接: ' + c.id);
  (c.sources || []).forEach(s => httpsUrl(s.url));
  if (c.category === 'magazine' || c.category === 'blogger' || c.video) assert.ok(c.sources && c.sources.length, '新素材必须附来源: ' + c.id);
  if (c.figure) { imgOk(c.figure.src); assert.ok(c.figure.alt, '缺 alt: ' + c.id); }
  if (c.video) { assert.match(c.video, /^[\w-]{11}$/); assert.ok(c.link.url.includes(c.video), '视频卡片的来源链接要指向同一视频: ' + c.id); }
  if (c.figure && /i\.ytimg\.com\/vi\//.test(c.figure.src)) assert.ok(c.video && c.figure.src.includes(c.video), 'YouTube 封面必须对应卡片视频: ' + c.id);
  if (c.category === 'blogger' && /instagram\.com/.test(c.link.url)) assert.ok(!c.figure, 'Instagram 博主不放未核实的帖子图: ' + c.id);
}
const bookIds = new Set();
for (const b of closet.lookbooks) {
  assert.ok(b.id && !bookIds.has(b.id)); bookIds.add(b.id);
  assert.ok(b.pages.length > 0, '空造型册: ' + b.id);
  for (const p of b.pages) { imgOk(p.image); httpsUrl(p.source); assert.ok(p.title && p.alt && p.shop && Array.isArray(p.tags)); }
}
// 6) 深链接：#closet 等能直接打开对应标签页
const appJs = readFileSync(join(root, 'public/assets/app.js'), 'utf8');
for (const t of ['tour', 'release', 'stage', 'closet']) assert.ok(appJs.includes(`'${t}'`) && readFileSync(join(root, 'public/index.html'), 'utf8').includes(`id="panel-${t}"`), '缺标签页: ' + t);
assert.ok(/location\.hash/.test(appJs), '需要支持 #标签 深链接');
// 7) 回归数据：每条有来源、id 唯一
const cb = JSON.parse(readFileSync(join(root, 'data/comebacks.json'), 'utf8'));
const cbIds = new Set();
// 早期两条（IVE / ILLIT 10/26）来源字段为空，待补；新条目（id > cb-46）必须带来源
for (const it of cb.items) { assert.ok(!cbIds.has(it.id), '回归 id 重复: ' + it.id); cbIds.add(it.id); if (Number(it.id.slice(3)) > 46) assert.ok(it.sources.length, '回归缺来源: ' + it.artist); it.sources.forEach(s => httpsUrl(s.url)); }
console.log('ok — 全部检查通过');
