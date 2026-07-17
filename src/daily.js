// 日次サマリーの純関数。records は db.js listMeasurements() の戻り値（新しい順）を前提とする。

/** ISO文字列 → ローカルタイムゾーンの日付キー 'YYYY-MM-DD'。不正なら null */
export function dateKeyOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 日付ごとにグループ化する。入力が新しい順なので、グループも新しい日順・
 * グループ内も新しい順になり、各グループの先頭がその日の最新（= 日次代表値）。
 * @returns {Array<{ dateKey: string, records: object[], latest: object }>}
 */
export function groupByDay(records) {
  const groups = [];
  const byKey = new Map();
  for (const r of records ?? []) {
    const key = dateKeyOf(r.measuredAt);
    if (key == null) continue;
    let g = byKey.get(key);
    if (!g) {
      g = { dateKey: key, records: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.records.push(r);
  }
  for (const g of groups) g.latest = g.records[0];
  return groups;
}

/** 1日1レコード（その日の最新）に間引く（推移グラフ用）。新しい順を保つ */
export function dailyLatest(records) {
  return groupByDay(records).map((g) => g.latest);
}
