import { METRICS } from './metrics.js';

const HEADER = ['日時', ...METRICS.map((m) => (m.unit ? `${m.label}(${m.unit})` : m.label))];

function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 測定レコード配列 → CSV文字列（ヘッダー付き・古い順） */
export function toCsv(records) {
  const rows = [HEADER.join(',')];
  const sorted = [...records].sort((a, b) => (a.measuredAt > b.measuredAt ? 1 : -1));
  for (const r of sorted) {
    const cells = [formatDate(r.measuredAt), ...METRICS.map((m) => r[m.key] ?? '')];
    rows.push(cells.join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

/**
 * CSVをファイルとして書き出す。
 * iOSでは共有シート（ファイル保存/AirDrop/メール等）を優先し、
 * 使えない環境ではダウンロードにフォールバックする。
 */
export async function exportCsv(records) {
  // BOM付きUTF-8（Excel/Numbersでの文字化け防止）
  const csv = '\uFEFF' + toCsv(records);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `karadascan-${stamp}.csv`;
  const file = new File([csv], filename, { type: 'text/csv' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // ユーザーがキャンセル
      // 共有に失敗したらダウンロードへフォールバック
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
