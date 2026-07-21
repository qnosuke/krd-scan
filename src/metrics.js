// KRD-203 の測定結果表示順と各項目の仕様（docs/spec.md 参照）
// 項目の判別は (a)表示順 (b)数値レンジ (c)小数点の有無 で行う。

// typicalMin/typicalMax は「現実の人間として自然な範囲」。機器仕様レンジは
// 広い（BMI 2.5〜90 等）ため項目判別の手がかりとして弱く、体重とBMIのように
// 範囲が重なる項目の曖昧さ解消に使う（外れても除外はせず不利になるだけ）
export const METRICS = [
  { key: 'weight', label: '体重', unit: 'kg', min: 2, max: 135.4, decimals: 1, typicalMin: 25, typicalMax: 150 },
  { key: 'bodyFat', label: '体脂肪率', unit: '%', min: 5.0, max: 50.0, decimals: 1 },
  { key: 'visceralFat', label: '内臓脂肪', unit: 'Lv', min: 1, max: 30, decimals: 0 },
  { key: 'skeletalMuscle', label: '骨格筋率', unit: '%', min: 5.0, max: 60.0, decimals: 1 },
  { key: 'bodyAge', label: '体年齢', unit: '才', min: 18, max: 80, decimals: 0 },
  { key: 'basalMetabolism', label: '基礎代謝', unit: 'kcal', min: 385, max: 3999, decimals: 0 },
  { key: 'bmi', label: 'BMI', unit: '', min: 2.5, max: 90.0, decimals: 1, typicalMin: 10, typicalMax: 45 },
];

export const METRIC_KEYS = METRICS.map((m) => m.key);

export function metricByKey(key) {
  return METRICS.find((m) => m.key === key) ?? null;
}

/**
 * 読み取った表示文字列（例 "62.7"）が指定項目としてあり得るか判定する。
 * 数値レンジに加えて小数点の桁数も見る（"22" は体脂肪率ではない、など）。
 */
export function matchesMetric(text, metric) {
  if (!/^\d+(\.\d)?$/.test(text)) return false;
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  if (decimals !== metric.decimals) return false;
  const value = Number(text);
  return value >= metric.min && value <= metric.max;
}

/** 手入力値の検証。空は許容（未計測扱い）。 */
export function validateInput(text, metric) {
  if (text === '' || text == null) return true;
  return matchesMetric(String(text), metric);
}

/**
 * 人が手で入力・修正した値の検証。OCR結果と違い小数点の有無で項目を判別する
 * 必要がないため、小数桁数は問わない（体重に "63" と入力しても有効）。
 */
export function validateHumanInput(text, metric) {
  if (text === '' || text == null) return true;
  if (!/^\d+(\.\d+)?$/.test(String(text))) return false;
  const value = Number(text);
  return value >= metric.min && value <= metric.max;
}

/** 手入力値を保存・表示用の固定小数桁フォーマットに正規化する。 */
export function normalizeHumanInput(text, metric) {
  return Number(text).toFixed(metric.decimals);
}
