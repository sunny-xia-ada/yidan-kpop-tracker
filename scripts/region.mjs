// 西雅图区域定义：巡演收录范围。构建不按城市或日期窗口过滤，
// 所有 data/tours.json 的 upcoming 都会生成页面和日历；本模块供自检使用，
// 防止以后误加“只收西雅图市区 / 只收未来 N 个月”的过滤。
export const SEATTLE_REGION_CITIES = [
  'Seattle', 'Tacoma', 'Bellevue', 'Redmond', 'Kirkland',
  'Everett', 'Kent', 'Snoqualmie', 'Renton', 'Issaquah',
  'Lynnwood', 'Tukwila', 'Federal Way', 'Shoreline', 'Bothell',
  'Woodinville', 'Sammamish', 'Mercer Island', 'Auburn',
  'Puyallup', 'Marysville'
];

export function seattleRegionHaystack(ev) {
  return [ev.venue?.name, ev.venue?.address, ev.title, ev.search, ev.artist].filter(Boolean).join(' ');
}

/** 场次是否落在西雅图区域（西雅图 + 塔科马 + Eastside 及附近合理场馆）。 */
export function inSeattleRegion(ev) {
  const text = seattleRegionHaystack(ev);
  if (/塔科马|西雅图|Eastside|贝尔维尤|雷德蒙德|柯克兰|埃弗里特/.test(text)) return true;
  return SEATTLE_REGION_CITIES.some((c) => new RegExp(`\\b${c}\\b`, 'i').test(text));
}
