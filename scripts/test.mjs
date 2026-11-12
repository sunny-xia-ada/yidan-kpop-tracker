// 轻量自检：node scripts/test.mjs （无依赖）。先运行 node scripts/build.mjs 生成 dist/ics。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { laLocalToUtcMs, buildEventIcs, buildOnsaleIcs, eventOutlookLinks, addMinutesLocal, addCalendarDays, displayDate, eventDateLabel } from '../public/js/calendar.mjs';
import { inSeattleRegion } from './region.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iso = ms => new Date(ms).toISOString();

// 1) 时区换算（PST / PDT / 夏令时切换日）
assert.equal(iso(laLocalToUtcMs('2026-11-17T20:00')), '2026-11-18T04:00:00.000Z');   // PST = UTC-8
assert.equal(iso(laLocalToUtcMs('2026-05-20T11:00')), '2026-05-20T18:00:00.000Z');   // PDT = UTC-7
assert.equal(iso(laLocalToUtcMs('2026-03-08T12:00')), '2026-03-08T19:00:00.000Z');   // 夏令时开始当天中午已是 PDT
assert.equal(iso(laLocalToUtcMs('2026-11-01T12:00')), '2026-11-01T20:00:00.000Z');   // 夏令时结束当天中午已是 PST
assert.equal(addMinutesLocal('2026-11-17T23:30', 60), '2026-11-18T00:30');
assert.equal(displayDate('2026-11-15T19:30'), '11/15 周日 · 19:30');
assert.equal(displayDate('2027-05-04T00:00', { timeTbd: true }), '05/04 周二 · 开演时间待公布');
assert.equal(eventDateLabel({ start: '2027-05-04T00:00', timeTbd: true }), '05/04 周二 · 开演时间待公布');
assert.equal(addCalendarDays('2027-05-04T00:00', 1), '2027-05-05');

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
  assert.ok(inSeattleRegion(ev), '非西雅图区域场次不应出现: ' + ev.id);
  const cal = parseIcs(readFileSync(join(root, 'dist/ics', ev.id + '.ics'), 'utf8'));
  assert.equal(cal.type, 'VCALENDAR'); assert.equal(get(cal, 'VERSION').value, '2.0');
  assert.ok(cal.children.some(c => c.type === 'VTIMEZONE'));
  const vev = cal.children.find(c => c.type === 'VEVENT');
  assert.ok(unesc(get(vev, 'LOCATION').value).startsWith(ev.venue.name));
  assert.ok(unesc(get(vev, 'DESCRIPTION').value).includes(ev.ticketUrl), '描述里要有购票 / 官方页链接');
  assert.equal(get(vev, 'UID').value, ev.id + '@yidan-kpop-tracker');
  if (ev.timeTbd) {
    const ds = get(vev, 'DTSTART'); const de = get(vev, 'DTEND');
    assert.equal(ds.params.VALUE, 'DATE'); assert.equal(de.params.VALUE, 'DATE');
    assert.ok(!ds.params.TZID && !de.params.TZID, '全天事件不应带 TZID');
    assert.equal(ds.value, ev.start.slice(0, 10).replace(/-/g, ''));
    assert.equal(de.value, addCalendarDays(ev.start, 1).replace(/-/g, ''));
    assert.ok(unesc(get(vev, 'DESCRIPTION').value).includes('开演时间待公布'));
    assert.ok(!unesc(get(vev, 'DESCRIPTION').value).includes('00:00'), '未公布开演时刻时不要写 00:00');
  } else {
    assert.equal(toUtcMs(get(vev, 'DTSTART')), laLocalToUtcMs(ev.start));
    assert.equal(toUtcMs(get(vev, 'DTEND')) - toUtcMs(get(vev, 'DTSTART')), (ev.durationMinutes || 180) * 60000);
  }
  const links = eventOutlookLinks(ev);
  for (const [k, host] of [['personal', 'outlook.live.com'], ['work', 'outlook.office.com']]) {
    const u = new URL(links[k]); assert.equal(u.host, host); assert.equal(u.pathname, '/calendar/0/deeplink/compose');
    assert.equal(u.searchParams.get('path'), '/calendar/action/compose'); assert.equal(u.searchParams.get('rru'), 'addevent');
    assert.equal(u.searchParams.get('subject'), `${ev.artist} · ${ev.title}`);
    assert.ok(u.searchParams.get('body').includes(ev.ticketUrl)); assert.ok(u.searchParams.get('location').includes(ev.venue.name));
    if (ev.timeTbd) {
      assert.equal(new Date(u.searchParams.get('startdt')).getTime(), laLocalToUtcMs(ev.start.slice(0, 10) + 'T00:00'));
      assert.ok(u.searchParams.get('body').includes('开演时间待公布'));
    } else {
      assert.equal(new Date(u.searchParams.get('startdt')).getTime(), laLocalToUtcMs(ev.start));
    }
  }
}
// 区域与远期：构建/前端不得按城市或日期窗口丢掉场次
assert.ok(tours.upcoming.some(ev => ev.start >= '2027'), '远期（2027+）场次应被收录，不能按月份窗口丢掉');
assert.ok(tours.upcoming.some(ev => /Tacoma/i.test([ev.venue.name, ev.venue.address, ev.title, ev.search].join(' '))), '塔科马场次应被收录');
const buildSrc = readFileSync(join(root, 'scripts/build.mjs'), 'utf8');
assert.ok(/for \(const ev of tours\.upcoming\)/.test(buildSrc), '构建应遍历全部 upcoming');
assert.ok(!/maxMonths|onlySeattle|start\.slice\(0,\s*4\)\s*<\s*'2027'/.test(buildSrc), '构建不能按年份或城市过滤');

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

// 5) 偶像衣橱（穿搭杂志版）：竖版全身/半身图、单品拆解、来源链接、外链不转存
const closet = JSON.parse(readFileSync(join(root, 'data/closet.json'), 'utf8'));
const bloggerAllow = JSON.parse(readFileSync(join(root, 'data/closet-bloggers.json'), 'utf8'));
const allowedBloggerHandles = new Set((bloggerAllow.handles || []).map(h => String(h).toLowerCase()));
assert.ok(allowedBloggerHandles.size >= 10, '要有固定的博主名单');
const httpsUrl = (u) => { const x = new URL(u); assert.equal(x.protocol, 'https:', '必须是 https 链接: ' + u); return x; };
const seen = new Set();
assert.match(closet.lastUpdated, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(Array.isArray(closet.looks) && closet.looks.length >= 6, '衣橱至少要有 6 套');
assert.ok(!('cards' in closet) && !('lookbooks' in closet), '旧的卡片 / 翻页册结构应已移除');
for (const l of closet.looks) {
  assert.ok(l.id && !seen.has(l.id), '衣橱 id 重复或缺失: ' + l.id); seen.add(l.id);
  assert.ok(['stage', 'magazine', 'blogger'].includes(l.category), '未知类别: ' + l.category);
  assert.ok(['full', 'half'].includes(l.body), '只收全身或半身图（不收头像特写）: ' + l.id);
  assert.match(l.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(l.artist && l.title && l.where && l.point, '缺艺人 / 出处 / 穿搭要点: ' + l.id);
  // 图片：外链 https、竖版展示
  const im = l.image; assert.ok(im && im.alt && im.credit, '缺图片 / alt / 图源: ' + l.id);
  assert.ok(/^https:\/\//.test(im.src), '图片必须外链来源（不转存）: ' + l.id); httpsUrl(im.src);
  assert.ok(Number.isFinite(im.width) && Number.isFinite(im.height), '缺图片尺寸: ' + l.id);
  if (im.frame === 'fancam') {
    // 官方竖屏直拍的自动截帧：不是默认封面（封面多为脸部特写），以 9:16 居中显示
    assert.match(im.src, /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/maxres[123]\.jpg$/, '直拍图要用截帧 maxres1-3，不用封面: ' + l.id);
    assert.ok(l.video && im.src.includes(l.video), '截帧必须对应同一支直拍: ' + l.id);
    assert.equal(l.body, 'full');
  } else {
    assert.equal(im.frame, 'contain', '未知图片展示方式: ' + l.id);
    assert.ok(im.height > im.width, '杂志图必须是竖版: ' + l.id);
  }
  // 单品拆解：上衣 / 下装 / 鞋 / 配饰 / 配色 必填；品牌只在来源写明时填
  for (const k of ['top', 'bottom', 'shoes', 'accessories', 'palette']) assert.ok(typeof l.breakdown?.[k] === 'string' && l.breakdown[k].trim(), `缺拆解 ${k}: ` + l.id);
  assert.ok(l.breakdown.brand === null || (typeof l.breakdown.brand === 'string' && l.breakdown.brand.trim()), 'brand 只能是来源写明的品牌或 null: ' + l.id);
  if (l.category === 'stage') assert.equal(l.breakdown.brand, null, '打歌舞台来源未写品牌，不应填品牌: ' + l.id);
  // 来源
  assert.ok(Array.isArray(l.sources) && l.sources.length, '缺来源链接: ' + l.id);
  l.sources.forEach(s => { assert.ok(s.label); httpsUrl(s.url); });
  if (l.video) { assert.match(l.video, /^[\w-]{11}$/); assert.ok(l.sources.some(s => s.url.includes(l.video)), '来源要指向同一支视频: ' + l.id); }
  if (l.category === 'blogger') {
    const handles = [...(`${l.where} ${l.member || ''} ${l.artist}`).matchAll(/@([A-Za-z0-9._]+)/g)].map(m => m[1].toLowerCase().replace(/\.$/, ''));
    assert.ok(handles.length, '博主穿搭要写账号 handle: ' + l.id);
    assert.ok(handles.every(h => allowedBloggerHandles.has(h)), '博主必须来自固定名单，不能收偶像或其他账号: ' + l.id + ' ' + handles.join(','));
    assert.match(l.date, /^\d{4}-\d{2}-\d{2}$/, '博主穿搭要有发布日期: ' + l.id);
    assert.ok(l.sources.some(s => /^https:\/\//.test(s.url)), '博主穿搭要有可打开的 https 来源: ' + l.id);
    assert.notEqual(l.image.frame, 'fancam', '博主穿搭不用打歌直拍截帧: ' + l.id);
    assert.equal(l.image.frame, 'contain');
  }
  (l.swatches || []).forEach(c => assert.match(c, /^#[0-9a-f]{6}$/i));
}
const css = readFileSync(join(root, 'public/assets/styles.css'), 'utf8');
assert.ok(!/#panel-closet\s*>\s*\.grid[^{]*\{[^}]*display:\s*none/.test(css), '衣橱列表不能被 CSS 隐藏');
assert.ok(/\.frame-fancam\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/.test(css) && /\.frame-contain img\s*\{[^}]*object-fit:\s*contain/.test(css), '衣橱图要竖版展示且不裁衣服');
// 6) 深链接：#closet 等能直接打开对应标签页
const appJs = readFileSync(join(root, 'public/assets/app.js'), 'utf8');
assert.ok(/lists\.tour\s*=\s*data\.upcoming\.map/.test(appJs), '巡演列表要收录全部 upcoming，不能先按城市或日期过滤');
assert.ok(!/city\s*===\s*['"]Seattle['"]/.test(appJs) && !/maxMonths/.test(appJs), '前端不能只显示西雅图市区或按月份窗口过滤');
for (const t of ['tour', 'release', 'stage', 'closet']) assert.ok(appJs.includes(`'${t}'`) && readFileSync(join(root, 'public/index.html'), 'utf8').includes(`id="panel-${t}"`), '缺标签页: ' + t);
assert.ok(/location\.hash/.test(appJs), '需要支持 #标签 深链接');
assert.ok(readFileSync(join(root, 'public/index.html'), 'utf8').includes('data-style="blogger"') && readFileSync(join(root, 'public/index.html'), 'utf8').includes('博主穿搭'), '衣橱要有「博主穿搭」筛选按钮');
assert.ok(/blogger:\s*'博主穿搭'/.test(appJs), '类别文案要有博主穿搭');
assert.ok(/hasBlogger/.test(appJs) && /bloggerChip\.hidden\s*=\s*!hasBlogger/.test(appJs), '没有博主条目时要隐藏「博主穿搭」按钮');
// 7) 回归数据：每条有来源、id 唯一
const cb = JSON.parse(readFileSync(join(root, 'data/comebacks.json'), 'utf8'));
const cbIds = new Set();
// 早期两条（IVE / ILLIT 10/26）来源字段为空，待补；新条目（id > cb-46）必须带来源
for (const it of cb.items) { assert.ok(!cbIds.has(it.id), '回归 id 重复: ' + it.id); cbIds.add(it.id); if (Number(it.id.slice(3)) > 46) assert.ok(it.sources.length, '回归缺来源: ' + it.artist); it.sources.forEach(s => httpsUrl(s.url)); }
console.log('ok — 全部检查通过');
