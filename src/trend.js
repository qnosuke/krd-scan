// 前回値・前回比の計算（純関数）。
// records は db.js listMeasurements() の戻り値（新しい順）を想定。
// 値は文字列のまま保存されている（"62.7" など。未計測は null）。

function numeric(record, key) {
  const raw = record?.[key];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** startIndex 以降で最初にその項目の値を持つレコードの数値。無ければ null */
export function previousValue(records, key, startIndex = 0) {
  for (let i = startIndex; i < records.length; i++) {
    const v = numeric(records[i], key);
    if (v != null) return v;
  }
  return null;
}

/** records[index] の値と、それより古い直近の値との差。どちらかが欠けていれば null */
export function computeDelta(records, key, index = 0) {
  const cur = numeric(records[index], key);
  if (cur == null) return null;
  const prev = previousValue(records, key, index + 1);
  if (prev == null) return null;
  return cur - prev;
}

/** 「▲0.3」「▼0.5」「±0」形式。増減の良し悪しは項目で逆なので色や評価は付けない */
export function formatDelta(delta, decimals = 1) {
  if (delta == null) return null;
  const rounded = Number(delta.toFixed(decimals));
  if (rounded > 0) return `▲${rounded.toFixed(decimals)}`;
  if (rounded < 0) return `▼${Math.abs(rounded).toFixed(decimals)}`;
  return '±0';
}
