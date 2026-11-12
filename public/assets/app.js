// K-pop 追踪 · 前端：所有内容来自 data/*.json（改数据即更新页面，无需改代码）
import { displayDate, eventDateLabel, eventOutlookLinks, icsPath, onsaleIcsPath, laLocalToUtcMs, pdtLabel, SALE_KINDS } from '../js/calendar.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.prototype.slice.call(root.querySelectorAll(sel));
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(kid => { if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid)); });
  return el;
}
const link = (label, url, cls) => h('a', { class: cls, href: url, target: '_blank', rel: 'noopener' }, label);
const sourceLine = (sources) => {
  const p = h('p', { class: 'c01' });
  sources.forEach((s, i) => { if (i) p.append(' · '); p.append(link(s.label, s.url)); });
  return p;
};
const sourcesDetails = (sources) => sources && sources.length ? h('details', null, h('summary', { text: '查看来源' }), sourceLine(sources)) : null;
const dlRows = (rows) => h('dl', { class: 'c11' }, rows.map(r => h('div', { class: 'c05' }, h('dt', { text: r.label }), h('dd', null, r.value, r.note ? h('small', { text: r.note }) : null))));
const badge = (b) => h('span', { class: 'c06' + (b.ok ? ' ok' : '') }, b.text);

async function loadJson(name) {
  const res = await fetch(`data/${name}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${name}.json ${res.status}`);
  return res.json();
}

/* ---------- Tabs ---------- */
const tabs = $$('.tabs [role="tab"]');
const panels = $$('[role="tabpanel"]');
function activateTab(name) {
  tabs.forEach(tab => {
    const active = tab.getAttribute('data-tab') === name;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.setAttribute('tabindex', active ? '0' : '-1');
  });
  panels.forEach(panel => { panel.hidden = panel.id !== 'panel-' + name; });
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => { activateTab(tab.getAttribute('data-tab')); history.replaceState(null, '', '#' + tab.getAttribute('data-tab')); });
  tab.addEventListener('keydown', event => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); activateTab(tabs[next].getAttribute('data-tab'));
  });
});
const TAB_NAMES = ['tour', 'release', 'stage', 'closet'];
const hashTab = location.hash.slice(1);
if (TAB_NAMES.includes(hashTab)) activateTab(hashTab);
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TAB_NAMES.includes(t)) activateTab(t); });

/* ---------- 通用过滤 / 排序 ---------- */
const states = { tour: { desc: false, verified: false, query: '' }, release: { desc: true, group: 'all', query: '' }, closet: { desc: true, style: 'all', query: '' } };
const lists = {};   // type -> [{el, data}]
function refresh(type) {
  const list = $(`[data-list="${type}"]`);
  const entries = lists[type] || [];
  const state = states[type];
  entries.sort((a, b) => {
    const diff = a.key.localeCompare(b.key);
    return state.desc ? -diff : diff;
  }).forEach(e => list.appendChild(e.el));
  let visible = 0;
  entries.forEach(({ el, data, search }) => {
    const ok = search.indexOf(state.query) !== -1
      && (type !== 'tour' || !state.verified || data.verified)
      && (type !== 'release' || state.group === 'all' || data.group === state.group)
      && (type !== 'closet' || state.style === 'all' || data.styles.includes(state.style));
    el.hidden = !ok;
    if (ok) visible += 1;
  });
  const count = $(`[data-count-for="${type}"]`);
  if (count) count.textContent = visible + (type === 'closet' ? ' 套' : ' 条');
  $(`[data-empty="${type}"]`).hidden = visible !== 0;
}
function wireTools(type) {
  const tools = $(`[data-tools="${type}"]`);
  $('.search', tools).addEventListener('input', e => { states[type].query = e.target.value.trim().toLowerCase(); refresh(type); });
  const sorter = $('[data-sort]', tools);
  if (sorter) sorter.addEventListener('click', e => {
    states[type].desc = !states[type].desc;
    e.currentTarget.textContent = type === 'tour' ? (states[type].desc ? '日期：远 → 近' : '日期：近 → 远') : (states[type].desc ? '日期：新 → 旧' : '日期：旧 → 新');
    refresh(type);
  });
  const verified = $('[data-verified-only]', tools);
  if (verified) verified.addEventListener('click', () => { states[type].verified = !states[type].verified; verified.setAttribute('aria-pressed', states[type].verified ? 'true' : 'false'); refresh(type); });
  ['group', 'style'].forEach(attr => {
    $$(`[data-${attr}]`, tools).forEach(button => button.addEventListener('click', () => {
      states[type][attr] = button.getAttribute('data-' + attr);
      $$(`[data-${attr}]`, tools).forEach(item => item.setAttribute('aria-pressed', item === button ? 'true' : 'false'));
      refresh(type);
    }));
  });
}
Object.keys(states).forEach(wireTools);

/* ---------- 巡演 ---------- */
const now = () => Date.now();
function saleBlock(ev) {
  const sales = ev.onsale ? ['presale', 'general'].filter(k => ev.onsale[k]).map(k => [k, ev.onsale[k]]) : [];
  const box = h('div', { class: 'onsale' }, h('p', { class: 'onsale-title', text: '开票信息' }));
  const known = sales.filter(([, s]) => s.start);
  if (!sales.length || (!known.length && ev.onsale.status !== 'on_sale')) {
    box.append(h('p', { class: 'onsale-line', text: '开票时间待公布' }));
    return box;
  }
  sales.forEach(([kind, s]) => {
    const line = h('div', { class: 'onsale-line' });
    const label = s.label || SALE_KINDS[kind];
    if (s.start) {
      const future = laLocalToUtcMs(s.start) > now();
      line.append(h('span', { class: 'c06' + (future ? ' pending' : ' ok') }, future ? '即将开票' : '已开售'), ' ',
        h('strong', null, label), h('small', { text: pdtLabel(s.start) + '（西雅图时间）' }));
      if (future) line.append(h('a', { class: 'btn-cal btn-alarm', href: onsaleIcsPath(ev, kind), type: 'text/calendar', 'aria-label': `开票提醒：${ev.artist} ${SALE_KINDS[kind]}，下载日历文件` }, '开票提醒', h('small', { text: '提前 1 天 + 30 分钟' })));
    } else {
      line.append(h('span', { class: 'c06 ok' }, '已开售'), ' ', h('strong', null, label), h('small', { text: '具体开票时间未核实' }));
    }
    if (s.url) line.append(' ', link('官方页面 ↗', s.url, 'inline-link'));
    box.append(line);
  });
  if (ev.onsale.note) box.append(h('p', { class: 'onsale-note', text: ev.onsale.note }));
  return box;
}
function calendarActions(ev) {
  const links = eventOutlookLinks(ev);
  return h('div', { class: 'cal-actions', role: 'group', 'aria-label': `把 ${ev.artist} 这场演出加到日历` },
    h('a', { class: 'btn-cal', href: icsPath(ev), type: 'text/calendar', 'aria-label': `${ev.artist} 加到 Outlook 日历：下载 .ics 文件（iPhone、Outlook、Google 日历通用）` }, '一键加到 Outlook 日历', h('small', { text: '.ics · iPhone / Outlook 通用' })),
    h('a', { class: 'btn-cal btn-web', href: links.personal, target: '_blank', rel: 'noopener' }, 'Outlook 网页版', h('small', { text: 'outlook.live.com' })),
    h('a', { class: 'btn-cal btn-web', href: links.work, target: '_blank', rel: 'noopener' }, 'Outlook 网页版', h('small', { text: 'office.com（工作/学校）' })));
}
function tourCard(ev) {
  const rows = [{ label: '日期', value: eventDateLabel(ev) }, { label: '场馆', value: ev.venue.name }, ...ev.rows];
  return h('article', { class: 'card' },
    h('div', { class: 'c02' },
      h('div', { class: 'meta' }, badge(ev.status), h('span', { class: 'c06', text: ev.tag })),
      h('h3', { class: 'artist', text: ev.artist }), h('p', { class: 'event', text: ev.title }),
      dlRows(rows), saleBlock(ev), calendarActions(ev)),
    sourcesDetails(ev.sources));
}
function renderTours(data) {
  const list = $('[data-mount="tour-list"]');
  lists.tour = data.upcoming.map(ev => ({ el: tourCard(ev), data: ev, key: ev.start, search: [ev.search, ev.artist, ev.title, ev.venue.name, ev.venue.address].join(' ').toLowerCase() }));
  lists.tour.forEach(e => list.append(e.el));
  const past = h('details', { class: 'c40' }, h('summary', { text: data.pastSummary }),
    h('div', { class: 'c26' }, data.past.map(p => h('div', null, h('h3', { text: p.title }), h('p', null, p.text,
      p.links && p.links.length ? [h('br'), p.links.map((l, i) => [i ? ' · ' : '', link(l.label, l.url)])] : null)))));
  $('[data-mount="tour-past"]').replaceWith(past);
  $('[data-mount="tour-notice"]').replaceWith(h('p', { class: 'notice' }, h('strong', { text: '票价怎么更新：' }), data.priceNotice, h('br'), h('br'), h('strong', { text: '关于距离：' }), data.distanceNotice,
    h('br'), h('br'), h('strong', { text: '日历与提醒：' }), '.ics 的时间均为西雅图时间（America/Los_Angeles，自动处理 PST/PDT），官方没公布结束时间时按约 3 小时估算。开票提醒只会在有官方核实的开票时间时出现，不会猜测。'));
  refresh('tour');
}

/* ---------- 官宣回归 ---------- */
function releaseCard(it) {
  return h('article', { class: 'card' },
    h('div', { class: 'c02' },
      h('div', { class: 'meta' }, it.badges.map(badge)),
      h('h3', { class: 'artist', text: it.artist }), h('p', { class: 'event', text: it.title }),
      dlRows(it.rows), it.note ? h('p', { class: 'c38', text: it.note }) : null),
    sourcesDetails(it.sources));
}
function renderReleases(data) {
  const list = $('[data-mount="release-list"]');
  lists.release = data.items.map(it => ({ el: releaseCard(it), data: it, key: it.sortKey, search: (it.search + ' ' + it.artist + ' ' + it.title).toLowerCase() }));
  lists.release.forEach(e => list.append(e.el));
  $('[data-mount="release-tracked"]').replaceWith(h('details', { class: 'c40' }, h('summary', { text: '查看追踪艺人名单' }),
    h('div', { class: 'c26' }, data.trackedArtists.groups.map(g => h('div', null, h('h3', { text: g.label }), h('p', { text: g.artists.join('、') }))))));
  $('[data-mount="release-notice"]').replaceWith(h('p', { class: 'notice' }, h('strong', { text: data.notice.split('：')[0] + '：' }), data.notice.split('：').slice(1).join('：')));
  refresh('release');
}

/* ---------- 舞台回顾 ---------- */
let stageEls = [];
function renderStages(data) {
  const mount = $('[data-mount="stage-sections"]');
  data.sections.forEach((sec, i) => {
    const rows = sec.items.map(it => {
      const p = h('p', { class: 'c00' }, it.basisLabel ? h('strong', { text: it.basisLabel }) : null, it.note);
      return h('article', { class: 'stage-row' },
        h('div', { class: 'c03' }, h('p', { class: 'c08', text: `${it.program} · ${it.date}` }), h('h4', { text: it.title }), p),
        link(it.link.label, it.link.url, 'c04'));
    });
    const headId = 'stage-title-' + i;
    const el = h('section', { class: 'stage-archive', 'aria-labelledby': headId },
      h('div', { class: 'c19' }, h('h3', { id: headId, text: sec.title }), h('span', { class: 'c44', text: `${sec.range} · ${sec.items.length} 场 · 新 → 旧` })),
      sec.note ? h('p', { class: 'c35', text: sec.note }) : null,
      h('div', { class: 'stage-list' }, rows));
    mount.append(el);
    stageEls.push(el);
  });
  const search = $('[data-stage-search]'), empty = $('[data-stage-empty]'), count = $('[data-stage-count]');
  function filter() {
    const q = search.value.trim().toLowerCase(); let visible = 0;
    stageEls.forEach(arch => {
      let n = 0;
      $$('.stage-row', arch).forEach(row => { const m = !q || row.textContent.toLowerCase().indexOf(q) !== -1; row.hidden = !m; if (m) n++; });
      arch.hidden = n === 0; visible += n;
    });
    empty.hidden = visible !== 0; count.textContent = visible + ' 场';
  }
  search.addEventListener('input', filter); filter();
}

/* ---------- 偶像衣橱（穿搭杂志版） ---------- */
// 每一套都是全身或半身图；图片直接引用来源，不转存。打歌舞台用官方竖屏直拍的自动截帧（1280×720，中间是竖屏画面，两侧是模糊背景），
// 以 9:16 显示、居中裁掉两侧模糊；杂志图按原比例完整显示（contain），不裁衣服。
const CATEGORY_LABELS = { stage: '打歌舞台', magazine: '杂志画报', blogger: '博主穿搭' };
const BODY_LABELS = { full: '全身', half: '半身' };
const BREAKDOWN = [['top', '上衣'], ['bottom', '下装'], ['shoes', '鞋'], ['accessories', '配饰'], ['palette', '配色'], ['brand', '品牌']];
const YT_ID = /^[\w-]{11}$/;
function lookFigure(l) {
  const im = l.image;
  const img = h('img', { src: im.src, alt: im.alt, width: im.width, height: im.height, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  const fig = h('figure', { class: 'look-fig frame-' + im.frame }, img,
    h('span', { class: 'look-body', text: BODY_LABELS[l.body] }),
    h('figcaption', { class: 'look-credit', text: '图：' + im.credit }));
  img.addEventListener('error', () => { fig.classList.add('img-failed'); img.hidden = true; fig.prepend(h('p', { class: 'look-fail' }, '图片暂时加载不出来，', link('点这里看原图来源 ↗', l.sources[0].url))); }, { once: true });
  if (l.video && YT_ID.test(l.video)) {
    const play = h('button', { class: 'look-play', type: 'button', 'aria-label': `在这里播放 ${l.artist} ${l.member} 官方直拍` }, '▶ 看直拍');
    play.addEventListener('click', () => {
      img.replaceWith(h('iframe', { class: 'look-video', src: `https://www.youtube-nocookie.com/embed/${l.video}?autoplay=1&rel=0&playsinline=1`, title: `${l.artist} ${l.member} ${l.title}`, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }));
      play.remove();
    });
    fig.append(play);
  }
  return fig;
}
function lookCard(l, i) {
  const b = l.breakdown;
  const rows = BREAKDOWN.map(([k, label]) => {
    let v = b[k];
    if (k === 'brand' && !v) v = '来源未写品牌';
    const dd = h('dd', null, k === 'palette' && l.swatches ? h('span', { class: 'look-sw', 'aria-hidden': 'true' }, l.swatches.map(c => h('i', { style: `--sw:${c}` }))) : null, v);
    return h('div', { class: 'look-row' + (k === 'brand' && !b.brand ? ' is-empty' : '') }, h('dt', { text: label }), dd);
  });
  return h('article', { class: 'look look-' + l.category, id: 'look-' + l.id },
    lookFigure(l),
    h('div', { class: 'look-copy' },
      h('p', { class: 'look-kicker' }, `${CATEGORY_LABELS[l.category]} · ${l.where}`),
      h('h3', { class: 'look-name' }, l.artist, l.member && l.member !== l.artist ? h('span', { text: ' ' + l.member }) : null),
      l.category === 'stage' ? h('p', { class: 'look-title', text: `《${l.title}》` }) : (l.title ? h('p', { class: 'look-title', text: l.title }) : null),
      h('p', { class: 'look-point' }, h('strong', { text: '穿搭要点 ' }), l.point),
      h('dl', { class: 'look-break' }, rows),
      h('p', { class: 'look-src' }, '来源：', l.sources.flatMap((s, j) => [j ? ' · ' : null, link(s.label + ' ↗', s.url)]))));
}
function renderCloset(data) {
  const issue = $('[data-closet-issue]'); if (issue) issue.textContent = data.issue;
  const list = $('[data-mount="closet-list"]');
  const hasBlogger = data.looks.some(l => l.category === 'blogger');
  const bloggerChip = $('[data-tools="closet"] [data-style="blogger"]');
  if (bloggerChip) bloggerChip.hidden = !hasBlogger;
  const sorted = data.looks.slice().sort((x, y) => y.date.localeCompare(x.date));
  lists.closet = sorted.map((l, i) => ({ el: lookCard(l, i), data: Object.assign({}, l, { styles: [l.category, l.body].concat(l.styles) }), key: l.date,
    search: [l.artist, l.member, l.title, l.where, l.point, ...Object.values(l.breakdown).filter(Boolean), ...l.styles].join(' ').toLowerCase() }));
  lists.closet.forEach(e => list.append(e.el));
  refresh('closet');
}

/* ---------- 启动 ---------- */
function showLoadError(name, err) {
  console.error(name, err);
  const panel = $(`#panel-${name}`);
  if (panel) panel.prepend(h('p', { class: 'notice', role: 'alert' }, `数据加载失败（data/${name}.json）：${err.message}`));
}
const files = { tour: ['tours', renderTours], release: ['comebacks', renderReleases], stage: ['stages', renderStages], closet: ['closet', renderCloset] };
const loaded = [];
await Promise.all(Object.entries(files).map(async ([panel, [file, render]]) => {
  try { const data = await loadJson(file); loaded.push(data.lastUpdated); render(data); }
  catch (err) { showLoadError(panel, err); }
}));
const last = loaded.filter(Boolean).sort().pop();   // 所有数据文件里最新的 lastUpdated
const stamp = $('[data-last-updated]');
if (last && stamp) {
  const [y, m, d] = last.split('-');
  $('strong', stamp).textContent = `${m}.${d}`; $('span', stamp).textContent = `最后更新 · ${y}`;
  stamp.setAttribute('aria-label', `最后更新于 ${y} 年 ${+m} 月 ${+d} 日`);
}
