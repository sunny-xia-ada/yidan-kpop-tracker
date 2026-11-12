# K-pop 追踪（yidan-kpop-tracker）

西雅图区域（西雅图 + 塔科马 + Eastside 及周边）视角的 K-pop 追星页：**巡演（含 Outlook 日历 / 开票提醒）· 官宣回归 · 舞台回顾 · 偶像衣橱**。已官宣的远期巡演（含 2027 及更后）都会收录。
纯静态站（原生 HTML/JS，无框架、无环境变量、无密钥），内容全部在 `data/*.json`，更新内容 = 提交数据。

## 目录

```
data/            ← 所有内容（每个文件都有 lastUpdated）
  site.json      页头文案
  tours.json     西雅图及周边巡演（upcoming / past），含 onsale 开票信息
  comebacks.json 官宣回归 + trackedArtists（参考名单，可留空）
  stages.json    舞台回顾（过去一个月 / 过去三个月热门）
  closet.json    偶像衣橱（lookbooks 杂志册 + cards 卡片）
public/          ← 前端（index.html、assets/app.js、styles.css、图片、js/calendar.mjs）
scripts/build.mjs  构建：public + data → dist，并按 tours.json 生成 dist/ics/*.ics
scripts/test.mjs   自检：时区换算、.ics 结构、VALARM、Outlook 链接
vercel.json      构建命令 node scripts/build.mjs，输出 dist/
```

## 本地运行

```bash
npm run build && npm test      # 生成 dist/ 并校验 .ics
npx serve dist                 # 或任意静态服务器；需要 http(s)，不能直接 file:// 打开
```

## 更新数据

| 想做的事 | 改哪里 |
|---|---|
| 新增/下架巡演 | `data/tours.json` 的 `upcoming`（演出结束后挪到 `past`） |
| 新增回归 | `data/comebacks.json` 的 `items`（`sortKey` 为排序用时间；`group`: `boy`/`girl`） |
| 新增舞台 | `data/stages.json` 对应 `sections[].items` |
| 新增造型册 / 卡片 | `data/closet.json`（图片放 `public/assets/`） |
| 固定追踪名单 | `data/comebacks.json` → `trackedArtists.groups`（现在只是参考，回归仍按每月新闻收集） |

改完同时更新该文件顶部的 `lastUpdated`，页头“最后更新”取所有数据文件里最新的那个日期。

### 巡演条目字段

```jsonc
{
  "id": "katseye-20261117",            // 稳定 ID，.ics 的 UID 与文件名由它生成
  "artist": "KATSEYE", "title": "WILDWORLD TOUR", "tag": "WILDWORLD TOUR",
  "status": { "text": "已核实", "ok": true }, "verified": true,
  "start": "2026-11-17T20:00",         // 西雅图本地时间（America/Los_Angeles），自动处理 PST/PDT
  "timeTbd": false,                    // 官方未公布开演时刻时设 true：页面显示待公布，日历为全天事件，不猜测钟点
  "durationMinutes": 180,              // 官方没给结束时间时的估算
  "doors": "18:30",                    // 可选
  "venue": { "name": "Climate Pledge Arena", "address": "334 1st Ave N, Seattle, WA 98109" },
  "ticketUrl": "https://…",            // 写进 .ics 描述
  "rows": [ { "label": "转售起售价", "value": "约 $251 起", "note": "SeatGeek 2026-11-02 快照" } ],
  "onsale": {                          // 可选；没有 = 页面显示“开票时间待公布”
    "status": "on_sale",               // 已开售但开票时间未核实
    "presale": { "label": "…", "start": "2026-05-20T11:00", "url": "官方链接" },
    "general": { "label": "…", "start": "2026-05-21T15:00", "url": "官方链接" },
    "note": "来源说明"
  },
  "sources": [ { "label": "…", "url": "…" } ]
}
```

**开票时间只填能从官方来源核实的**（场馆/主办方/艺人官方公告）；不确定就不要写 `start`。有 `start` 且在未来的预售/公开发售，卡片上会出现“开票提醒”按钮（下载 .ics：开票时刻事件 + 提前 1 天、提前 30 分钟两个提醒）。

## 日历功能

* **一键加到 Outlook 日历**：每场演出一个 `.ics`（`ics/<id>.ics`，构建时生成，`Content-Type: text/calendar`）。含 VTIMEZONE（America/Los_Angeles）、场馆地址、购票链接；iPhone 点击直接弹“添加到日历”，Outlook / Google 日历也可导入。
* **Outlook 网页版**：`outlook.live.com`（个人）与 `outlook.office.com`（工作/学校）的 `calendar/0/deeplink/compose` 链接，时间以 UTC 精确传递，避免被账户默认时区误读。
* **开票提醒**：见上。

## 部署说明（重要）

* 分支：`preview` 为开发/预览分支；`main` 目前只放 README 和一份 `vercel.json`，其中 `git.deploymentEnabled.main = false`，**防止误触发生产部署**。准备上线时：把 `preview` 合并到 `main`（合并后的 `vercel.json` 不再禁用 main）。
* Vercel 项目 `yidan-kpop-tracker`（团队 sunny-yidans-projects）只连接本仓库。
* 不需要任何环境变量。
