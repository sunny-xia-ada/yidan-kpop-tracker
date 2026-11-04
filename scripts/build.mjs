// 零依赖静态构建：public/ + data/ → dist/，并按 data/tours.json 生成 dist/ics/*.ics
// 用法：node scripts/build.mjs   （Vercel 构建命令；数据提交后自动重新生成）
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildEventIcs, buildOnsaleIcs, icsPath, onsaleIcsPath } from '../public/js/calendar.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'public'), dist, { recursive: true });
cpSync(join(root, 'data'), join(dist, 'data'), { recursive: true });
mkdirSync(join(dist, 'ics'), { recursive: true });

const tours = JSON.parse(readFileSync(join(root, 'data', 'tours.json'), 'utf8'));
const now = Date.now();
let n = 0;
for (const ev of tours.upcoming) {
  writeFileSync(join(dist, icsPath(ev)), buildEventIcs(ev, now)); n++;
  for (const kind of ['presale', 'general']) {
    if (ev.onsale?.[kind]?.start) { writeFileSync(join(dist, onsaleIcsPath(ev, kind)), buildOnsaleIcs(ev, kind, now)); n++; }
  }
}
console.log(`build ok: ${tours.upcoming.length} 场演出，生成 ${n} 个 .ics → dist/`);
