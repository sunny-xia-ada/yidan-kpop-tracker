// 日历工具：生成 .ics（iPhone / Outlook 通用）与 Outlook 网页版 deeplink。
// 纯函数、无依赖；浏览器（app.js）与 Node（scripts/build.mjs、测试）共用。
export const TZ = 'America/Los_Angeles';
const PRODID = '-//yidan-kpop-tracker//K-pop 追踪//ZH';

const pad = (n, w = 2) => String(n).padStart(w, '0');

function parseLocal(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || '');
  if (!m) throw new Error('时间格式应为 YYYY-MM-DDTHH:mm（西雅图时间）：' + local);
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});
function tzOffsetMs(utcMs) {
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}
/** 西雅图本地时间字符串 → UTC 毫秒（自动处理 PST/PDT）。 */
export function laLocalToUtcMs(local) {
  const t = parseLocal(local);
  const naive = Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi);
  let guess = naive - tzOffsetMs(naive);
  guess = naive - tzOffsetMs(guess);
  return guess;
}
/** 本地时间字符串加分钟（按墙上时钟，不跨夏令时边界处理，演出场景足够）。 */
export function addMinutesLocal(local, minutes) {
  const t = parseLocal(local);
  const d = new Date(Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi) + minutes * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
const icsLocal = (local) => local.replace(/[-:]/g, '') + '00';              // 20261115T193000
const icsUtc = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
const isoUtc = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const pdtLabel = (local) => {
  const off = tzOffsetMs(laLocalToUtcMs(local)) / 3600000;
  return `${local.slice(0, 10)} ${local.slice(11)} ${off === -7 ? 'PDT' : 'PST'}`;
};

export function escapeText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
/** RFC 5545 折行：每行不超过 75 个 octet（按 UTF-8 字符边界折）。 */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = ''; let curLen = 0; let limit = 75;
  for (const ch of line) {
    const l = enc.encode(ch).length;
    if (curLen + l > limit) { out.push(cur); cur = ''; curLen = 0; limit = 74; }
    cur += ch; curLen += l;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZ}`, `X-LIC-LOCATION:${TZ}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'TZNAME:PDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800', 'TZNAME:PST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE'
];

function wrapCalendar(veventLines) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-TIMEZONE:' + TZ, ...VTIMEZONE, ...veventLines, 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function weekdayOf(local) { const t = parseLocal(local); return WEEK[new Date(Date.UTC(t.y, t.mo - 1, t.d)).getUTCDay()]; }
export function displayDate(local, opts = {}) {
  const t = parseLocal(local);
  const day = `${pad(t.mo)}/${pad(t.d)} ${weekdayOf(local)}`;
  if (opts.timeTbd) return `${day} · 开演时间待公布`;
  return `${day} · ${pad(t.h)}:${pad(t.mi)}`;
}
export function eventDateLabel(ev) { return displayDate(ev.start, { timeTbd: ev.timeTbd }); }
/** 日历日加一天（用于全天事件的 DTEND，按 RFC 5545 不含结束当天）。 */
export function addCalendarDays(local, days) {
  const t = parseLocal(local.includes('T') ? local : local + 'T00:00');
  const d = new Date(Date.UTC(t.y, t.mo - 1, t.d) + days * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function eventTitle(ev) { return `${ev.artist} · ${ev.title}`; }
export function eventLocation(ev) { return ev.venue.address ? `${ev.venue.name}, ${ev.venue.address}` : ev.venue.name; }
export function eventDescription(ev) {
  const lines = [`${ev.artist} — ${ev.title}`, `场馆：${eventLocation(ev)}`];
  if (ev.timeTbd) lines.push(`开演：${eventDateLabel(ev)}（西雅图时间；官方尚未公布具体时刻，此日历事件为全天）`);
  else lines.push(`开演：${displayDate(ev.start)}（西雅图时间 ${pdtLabel(ev.start).slice(-3)}）`);
  if (ev.doors && !ev.timeTbd) lines.push(`开门：${ev.doors}（以场馆官方页为准）`);
  if (ev.ticketUrl) lines.push(`购票 / 官方票务页：${ev.ticketUrl}`);
  (ev.rows || []).forEach(r => lines.push(`${r.label}：${r.value}${r.note ? '（' + r.note + '）' : ''}`));
  lines.push('提示：票价为每周一、周四查询的快照，不是实时价格；请以官方票务页为准。');
  if (!ev.endsKnown) lines.push(`结束时间为估算（约 ${Math.round((ev.durationMinutes || 180) / 60)} 小时），官方未公布。`);
  return lines.join('\n');
}
const dtstamp = (now) => icsUtc(now);

/** 单场演出的 .ics。开演时刻未公布时生成全天事件，不猜测开演时间。 */
export function buildEventIcs(ev, now = Date.now()) {
  const startEnd = ev.timeTbd
    ? [`DTSTART;VALUE=DATE:${ev.start.slice(0, 10).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addCalendarDays(ev.start, 1).replace(/-/g, '')}`]
    : [`DTSTART;TZID=${TZ}:${icsLocal(ev.start)}`, `DTEND;TZID=${TZ}:${icsLocal(addMinutesLocal(ev.start, ev.durationMinutes || 180))}`];
  return wrapCalendar([
    'BEGIN:VEVENT',
    `UID:${ev.id}@yidan-kpop-tracker`,
    `DTSTAMP:${dtstamp(now)}`,
    ...startEnd,
    `SUMMARY:${escapeText(eventTitle(ev))}`,
    `LOCATION:${escapeText(eventLocation(ev))}`,
    `DESCRIPTION:${escapeText(eventDescription(ev))}`,
    ...(ev.ticketUrl ? [`URL:${ev.ticketUrl}`] : []),
    'STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'SEQUENCE:0',
    'END:VEVENT'
  ]);
}

export const SALE_KINDS = { presale: '预售', general: '公开发售' };
export function saleTitle(ev, kind, sale) { return `开票提醒：${ev.artist} ${SALE_KINDS[kind]}（${ev.venue.name}）`; }
export function saleDescription(ev, kind, sale) {
  const lines = [`${ev.artist} — ${ev.title}`, `${sale.label || SALE_KINDS[kind]}：${pdtLabel(sale.start)}（西雅图时间）`, `演出：${displayDate(ev.start)} · ${eventLocation(ev)}`];
  if (sale.url) lines.push(`开票链接：${sale.url}`);
  lines.push('本日历事件带有两次提醒：开票前 1 天、开票前 30 分钟。', '开票时间来自官方来源；若官方改期，请以官方页面为准。');
  return lines.join('\n');
}
/** 开票提醒 .ics：事件在开票时刻，带 VALARM：提前 1 天、提前 30 分钟 */
export function buildOnsaleIcs(ev, kind, now = Date.now()) {
  const sale = ev.onsale && ev.onsale[kind];
  if (!sale || !sale.start) throw new Error(`${ev.id} 没有可核实的 ${kind} 开票时间`);
  const end = addMinutesLocal(sale.start, 30);
  const alarm = (trigger, text) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(text)}`, `TRIGGER:${trigger}`, 'END:VALARM'];
  return wrapCalendar([
    'BEGIN:VEVENT',
    `UID:${ev.id}-onsale-${kind}@yidan-kpop-tracker`,
    `DTSTAMP:${dtstamp(now)}`,
    `DTSTART;TZID=${TZ}:${icsLocal(sale.start)}`,
    `DTEND;TZID=${TZ}:${icsLocal(end)}`,
    `SUMMARY:${escapeText(saleTitle(ev, kind, sale))}`,
    `LOCATION:${escapeText(eventLocation(ev))}`,
    `DESCRIPTION:${escapeText(saleDescription(ev, kind, sale))}`,
    ...(sale.url ? [`URL:${sale.url}`] : []),
    'STATUS:CONFIRMED', 'TRANSP:TRANSPARENT', 'SEQUENCE:0',
    ...alarm('-P1D', `明天开票：${ev.artist} ${SALE_KINDS[kind]}`),
    ...alarm('-PT30M', `30 分钟后开票：${ev.artist} ${SALE_KINDS[kind]}`),
    'END:VEVENT'
  ]);
}

/** Outlook 网页版 deeplink（时间用 UTC 精确表示，避免被解释成账户默认时区）。 */
export function outlookCompose(host, { subject, startLocal, endLocal, location, body }) {
  const q = new URLSearchParams({
    path: '/calendar/action/compose', rru: 'addevent', subject,
    startdt: isoUtc(laLocalToUtcMs(startLocal)).replace('Z', '+00:00'),
    enddt: isoUtc(laLocalToUtcMs(endLocal)).replace('Z', '+00:00'),
    location: location || '', body: body || ''
  });
  return `https://${host}/calendar/0/deeplink/compose?${q.toString().replace(/\+/g, '%20').replace(/%2B00%3A00/g, '%2B00:00')}`;
}
export const OUTLOOK_HOSTS = { personal: 'outlook.live.com', work: 'outlook.office.com' };
export function eventOutlookLinks(ev) {
  const args = ev.timeTbd
    ? { subject: eventTitle(ev), startLocal: ev.start.slice(0, 10) + 'T00:00', endLocal: addCalendarDays(ev.start, 1) + 'T00:00', location: eventLocation(ev), body: eventDescription(ev) }
    : { subject: eventTitle(ev), startLocal: ev.start, endLocal: addMinutesLocal(ev.start, ev.durationMinutes || 180), location: eventLocation(ev), body: eventDescription(ev) };
  return { personal: outlookCompose(OUTLOOK_HOSTS.personal, args), work: outlookCompose(OUTLOOK_HOSTS.work, args) };
}
export const icsPath = (ev) => `ics/${ev.id}.ics`;
export const onsaleIcsPath = (ev, kind) => `ics/${ev.id}-onsale-${kind}.ics`;
