// CSVインポートの純関数。DOM・IndexedDBに触れない。
// 対象は自アプリ（csv.js toCsv）の書き出し形式のみ。検証は全か無か:
// 1行でも不正があれば何も取り込まず { ok:false, error:{line, reason} } を返す。
import { METRICS, validateInput } from './metrics.js';
import { HEADER, formatDate } from './csv.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/**
 * 日時セル（ローカル時刻 'YYYY-MM-DD HH:MM'）→ ISO文字列。
 * 繰り上がり（2026-02-30 → 3月2日）を検出して実在しない日時は null。
 */
function parseLocalDate(cell) {
  const [datePart, timePart] = cell.split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const date = new Date(y, mo - 1, d, h, mi);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi
  ) {
    return null;
  }
  return date.toISOString();
}

/** CSVテキスト → { ok:true, records } | { ok:false, error:{line, reason} }（lineは1始まり） */
export function parseCsvText(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  if (lines.length === 0) {
    return { ok: false, error: { line: 1, reason: 'ファイルが空です' } };
  }
  if (lines[0] !== HEADER.join(',')) {
    return {
      ok: false,
      error: { line: 1, reason: 'このアプリが書き出したCSVではないようです（ヘッダーが一致しません）' },
    };
  }

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = i + 1;
    const cells = lines[i].split(',');
    if (cells.length !== METRICS.length + 1) {
      return { ok: false, error: { line, reason: `列数が${cells.length}です（${METRICS.length + 1}列必要）` } };
    }

    const dateCell = cells[0];
    if (!DATE_RE.test(dateCell)) {
      return { ok: false, error: { line, reason: `日時「${dateCell}」の形式が不正です` } };
    }
    const measuredAt = parseLocalDate(dateCell);
    if (measuredAt === null) {
      return { ok: false, error: { line, reason: `日時「${dateCell}」は実在しない日時です` } };
    }

    const record = { measuredAt };
    for (let j = 0; j < METRICS.length; j++) {
      const m = METRICS[j];
      const value = cells[j + 1];
      if (!validateInput(value, m)) {
        return { ok: false, error: { line, reason: `${m.label}の値「${value}」が不正です` } };
      }
      record[m.key] = value === '' ? null : value;
    }
    records.push(record);
  }
  return { ok: true, records };
}

/**
 * 分単位の日時キー（CSVの日時セル形式 = formatDate）で重複を除外する。
 * 既存レコードの measuredAt は秒つきISOなので、同じ formatDate で
 * 正規化して比較する（読み戻し時の二重登録を防ぐ肝）。
 */
export function dedupeByDateKey(records, existingRecords) {
  const seen = new Set(existingRecords.map((r) => formatDate(r.measuredAt)));
  const fresh = [];
  let skipped = 0;
  for (const r of records) {
    const key = formatDate(r.measuredAt);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key); // CSV内部の同日時重複も1件にまとめる
    fresh.push(r);
  }
  return { fresh, skipped };
}
