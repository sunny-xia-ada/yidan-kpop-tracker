// K-pop 追踪 · 前端：所有内容来自 data/*.json（改数据即更新页面，无需改代码）
import { displayDate, eventOutlookLinks, icsPath, onsaleIcsPath, laLocalToUtcMs, pdtLabel, SALE_KINDS } from '../js/calendar.mjs';

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
    if (type === 'closet') {
      if (a.data.visual !== b.data.visual) return a.data.visual ? -1 : 1;
      const as = a.data.styles.includes('stage'), bs = b.data.styles.includes('stage');
      if (as !== bs) return as ? -1 : 1;
    }
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
  if (count) count.textContent = visible + ' 条';
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
  return h('div', { class: 'cal-actions', role: 'group', 'aria-label': `把 ${ev.artist} 西雅图场加到日历` },
    h('a', { class: 'btn-cal', href: icsPath(ev), type: 'text/calendar', 'aria-label': `${ev.artist} 加到 Outlook 日历：下载 .ics 文件（iPhone、Outlook、Google 日历通用）` }, '一键加到 Outlook 日历', h('small', { text: '.ics · iPhone / Outlook 通用' })),
    h('a', { class: 'btn-cal btn-web', href: links.personal, target: '_blank', rel: 'noopener' }, 'Outlook 网页版', h('small', { text: 'outlook.live.com' })),
    h('a', { class: 'btn-cal btn-web', href: links.work, target: '_blank', rel: 'noopener' }, 'Outlook 网页版', h('small', { text: 'office.com（工作/学校）' })));
}
function tourCard(ev) {
  const rows = [{ label: '日期', value: displayDate(ev.start) }, { label: '场馆', value: ev.venue.name }, ...ev.rows];
  return h('article', { class: 'card' },
    h('div', { class: 'c02' },
      h('div', { class: 'meta' }, badge(ev.status), h('span', { class: 'c06', text: ev.tag })),
      h('h3', { class: 'artist', text: ev.artist }), h('p', { class: 'event', text: ev.title }),
      dlRows(rows), saleBlock(ev), calendarActions(ev)),
    sourcesDetails(ev.sources));
}
function renderTours(data) {
  const list = $('[data-mount="tour-list"]');
  lists.tour = data.upcoming.map(ev => ({ el: tourCard(ev), data: ev, key: ev.start, search: [ev.search, ev.artist, ev.title, ev.venue.name].join(' ').toLowerCase() }));
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

/* ---------- 偶像衣橱 ---------- */
// 图片一律直接引用来源（官方 YouTube 封面 / 杂志官网），不转存；外链图加载失败时显示来源提示而不是破图。
const CATEGORY_LABELS = { stage: '打歌舞台', mv: 'MV / 预告', magazine: '杂志', blogger: '博主 · 街拍' };
const isRemote = (src) => /^https?:\/\//.test(src || '');
const YT_ID = /^[\w-]{11}$/;
function remoteImg(attrs) {
  const img = h('img', Object.assign({ loading: 'lazy', decoding: 'async' }, attrs, isRemote(attrs.src) ? { referrerpolicy: 'no-referrer' } : {}));
  img.addEventListener('error', () => { img.hidden = true; const f = img.closest('figure'); if (f) f.classList.add('img-failed'); }, { once: true });
  return img;
}
function closetFigure(c) {
  const f = c.figure;
  const img = remoteImg({ src: f.src, alt: f.alt, width: f.width, height: f.height });
  const fig = h('figure', { class: 'c16' + (c.video ? ' has-video' : '') }, img,
    h('figcaption', null, f.caption, f.credit ? h('small', { class: 'img-credit', text: f.credit }) : null));
  if (c.video && YT_ID.test(c.video)) {
    const play = h('button', { class: 'play-btn', type: 'button', 'aria-label': `在这里播放 ${c.artist} ${c.title} 官方舞台视频` }, '▶ 播放舞台');
    play.addEventListener('click', () => {
      const frame = h('iframe', { class: 'yt-embed', src: `https://www.youtube-nocookie.com/embed/${c.video}?autoplay=1&rel=0&playsinline=1`, title: `${c.artist} ${c.title}`, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin' });
      img.replaceWith(frame); play.remove();
    });
    fig.insertBefore(play, fig.querySelector('figcaption'));
  }
  return fig;
}
function closetCard(c) {
  const kids = [];
  if (c.ribbon) kids.push(h('span', { class: 'ribbon', text: c.ribbon }));
  if (c.figure) kids.push(closetFigure(c));
  kids.push(h('div', { class: 'c18', 'aria-hidden': 'true' }, c.swatches.map(s => h('span', { style: `--swatch:${s}` }))));
  const body = h('div', { class: 'c02' },
    h('div', { class: 'meta' }, CATEGORY_LABELS[c.category] ? h('span', { class: 'c06 cat-' + c.category, text: CATEGORY_LABELS[c.category] }) : null, c.badges.map(badge)),
    h('h3', { class: 'artist', text: c.artist }), h('p', { class: 'event', text: c.title }),
    c.sections.map(s => h('div', { class: 'c07' }, h('h4', { text: s.heading }), s.paragraphs.map(p => p.label ? h('p', { class: 'c15' }, h('strong', { text: p.label }), p.text) : h('p', { text: p.text })))),
    c.tags.length ? h('div', { class: 'c13' }, c.tags.map(t => h('span', { class: 'style-tag', text: t }))) : null,
    c.link ? link(c.link.label, c.link.url, 'c04') : null,
    sourcesDetails(c.sources));
  kids.push(body);
  return h('article', { class: 'card c14' + (c.highlight ? ' c36' : '') }, kids);
}
function renderCloset(data) {
  $('.c42').textContent = data.issue;
  const count = $('#panel-closet .c12 .count'); if (count) count.textContent = data.lookbooks.length + ' 本';
  const kicker = $('.c17 p'); if (kicker) kicker.textContent = `${data.lookbooks.length} LOOKBOOKS · SWIPE EDITION`;
  const list = $('[data-mount="closet-list"]');
  lists.closet = data.cards.map(c => ({ el: closetCard(c), data: c, key: c.date, search: (c.search + ' ' + c.artist + ' ' + c.title).toLowerCase() }));
  lists.closet.forEach(e => list.append(e.el));
  refresh('closet');
  initMagazine(data.lookbooks);
  // 只有主页、没有可核实单帖图片的博主：在翻阅室下方列出主页链接
  const bloggers = data.cards.filter(c => c.category === 'blogger' && !c.figure && c.link);
  if (bloggers.length) {
    const p = h('p', { class: 'c31 blogger-links' }, h('strong', { text: '博主主页推荐：' }));
    bloggers.forEach((c, i) => { if (i) p.append(' · '); p.append(link(c.artist, c.link.url)); p.append(h('small', { text: '（' + c.title.replace(/^Instagram · /, '') + '）' })); });
    $('.magazine').append(p);
  }
}
function initMagazine(books) {
  const byId = Object.fromEntries(books.map(b => [b.id, b]));
  const state = { book: books[0].id, page: 0 };
  const bar = $('.c27');
  books.forEach(b => bar.append(h('button', { class: 'c09', type: 'button', role: 'tab', 'aria-selected': 'false', 'data-mag-book': b.id, text: `${b.label} · ${b.pages.length}` })));
  const el = n => $(`[data-mag-${n}]`);
  const image = el('image'), stage = el('stage');
  image.addEventListener('error', () => { image.hidden = true; image.closest('figure').classList.add('img-failed'); });
  function render() {
    const book = byId[state.book], page = book.pages[state.page];
    if (isRemote(page.image)) image.setAttribute('referrerpolicy', 'no-referrer'); else image.removeAttribute('referrerpolicy');
    image.hidden = false; image.closest('figure').classList.remove('img-failed');
    image.src = page.image; image.alt = page.alt;
    el('kicker').textContent = book.artist; el('title').textContent = page.title; el('caption').textContent = page.caption;
    const note = el('note'); if (page.note) { note.textContent = page.note; note.hidden = false; } else { note.textContent = ''; note.hidden = true; }
    el('folio').textContent = String(state.page + 1).padStart(2, '0');
    el('status').textContent = `${state.page + 1} / ${book.pages.length}`;
    el('source').href = page.source;
    el('source').textContent = /youtube\.com\/watch/.test(page.source) ? '看官方舞台视频 ↗' : '打开图片来源 ↗';
    el('musinsa').href = 'https://global.musinsa.com/us/search?gender=F&keyword=' + encodeURIComponent(page.shop.musinsa) + '&sortCode=POPULAR';
    el('lewkin').href = 'https://lewkin.com/search?q=' + encodeURIComponent(page.shop.lewkin);
    const tags = el('tags'); tags.replaceChildren(...page.tags.map(t => h('span', { class: 'style-tag', text: t })));
    el('prev').disabled = state.page === 0; el('next').disabled = state.page === book.pages.length - 1;
    $$('[data-mag-book]').forEach(b => b.setAttribute('aria-selected', b.getAttribute('data-mag-book') === state.book ? 'true' : 'false'));
  }
  function turn(d) { const len = byId[state.book].pages.length; state.page = Math.max(0, Math.min(len - 1, state.page + d)); render(); }
  el('prev').addEventListener('click', () => turn(-1));
  el('next').addEventListener('click', () => turn(1));
  $$('[data-mag-book]').forEach(b => b.addEventListener('click', () => { state.book = b.getAttribute('data-mag-book'); state.page = 0; render(); }));
  stage.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); turn(e.key === 'ArrowRight' ? 1 : -1); } });
  let x0 = 0;
  stage.addEventListener('touchstart', e => { x0 = e.changedTouches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', e => { const d = e.changedTouches[0].clientX - x0; if (Math.abs(d) > 45) turn(d < 0 ? 1 : -1); }, { passive: true });
  render();
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
