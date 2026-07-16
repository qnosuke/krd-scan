import { describe, it, expect } from 'vitest';
import { parseCsvText, dedupeByDateKey } from '../src/csvImport.js';
import { toCsv, formatDate, HEADER } from '../src/csv.js';

// 全項目そろった1レコード（値はDBと同じ文字列表現）
const rec = (measuredAt, over = {}) => ({
  measuredAt,
  weight: '63.4',
  bodyFat: '22.9',
  visceralFat: '8',
  skeletalMuscle: '34.3',
  bodyAge: '42',
  basalMetabolism: '1507',
  bmi: '22.4',
  ...over,
});

const HEADER_LINE = HEADER.join(',');

describe('parseCsvText 正常系', () => {
  it('往復: toCsv の出力を読み戻すと値と分単位日時が一致する', () => {
    const original = [
      rec('2026-07-15T08:30:45.000Z'),
      rec('2026-07-14T08:31:12.000Z', { weight: '63.9', visceralFat: null }),
    ];
    const result = parseCsvText(toCsv(original));
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(2);
    // toCsv は古い順に並べ替えるので [0] が 07-14
    expect(result.records[0].weight).toBe('63.9');
    expect(result.records[0].visceralFat).toBeNull();
    expect(result.records[1].weight).toBe('63.4');
    expect(result.records[1].bmi).toBe('22.4');
    // 分単位の日時キーが往復で保存される
    expect(formatDate(result.records[1].measuredAt)).toBe(formatDate(original[0].measuredAt));
  });

  it('BOMつき・LF改行・末尾空行を受け付ける', () => {
    const text = '\uFEFF' + HEADER_LINE + '\n2026-07-15 08:30,63.4,22.9,8,34.3,42,1507,22.4\n\n';
    const result = parseCsvText(text);
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(formatDate(result.records[0].measuredAt)).toBe('2026-07-15 08:30');
  });

  it('空セルは null（未計測）になる', () => {
    const text = HEADER_LINE + '\r\n2026-07-15 08:30,63.4,,,,,,';
    const result = parseCsvText(text);
    expect(result.ok).toBe(true);
    expect(result.records[0].weight).toBe('63.4');
    expect(result.records[0].bodyFat).toBeNull();
    expect(result.records[0].bmi).toBeNull();
  });

  it('データ行ゼロ（ヘッダーのみ）は ok で records 空', () => {
    const result = parseCsvText(HEADER_LINE + '\r\n');
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(0);
  });
});

describe('parseCsvText 異常系（全か無か）', () => {
  it('空ファイルはエラー', () => {
    const result = parseCsvText('');
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(1);
  });

  it('ヘッダー不一致は「このアプリのCSVではない」', () => {
    const result = parseCsvText('date,weight\n2026-07-15 08:30,63.4');
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(1);
    expect(result.error.reason).toContain('このアプリ');
  });

  it('列数不足は行番号つきエラー', () => {
    const text = HEADER_LINE + '\n2026-07-15 08:30,63.4,22.9';
    const result = parseCsvText(text);
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(2);
    expect(result.error.reason).toContain('列');
  });

  it('日時の形式不正は行番号つきエラー', () => {
    const text = HEADER_LINE + '\n2026/07/15 08:30,63.4,22.9,8,34.3,42,1507,22.4';
    const result = parseCsvText(text);
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(2);
    expect(result.error.reason).toContain('日時');
  });

  it('実在しない日時（2026-02-30）はエラー', () => {
    const text = HEADER_LINE + '\n2026-02-30 08:30,63.4,22.9,8,34.3,42,1507,22.4';
    const result = parseCsvText(text);
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(2);
  });

  it('範囲外の値（体重999.9）は項目名つきエラー', () => {
    const text = HEADER_LINE + '\n2026-07-15 08:30,999.9,22.9,8,34.3,42,1507,22.4';
    const result = parseCsvText(text);
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(2);
    expect(result.error.reason).toContain('体重');
  });

  it('2行目が正常でも3行目が不正なら全体エラー', () => {
    const text =
      HEADER_LINE +
      '\n2026-07-15 08:30,63.4,22.9,8,34.3,42,1507,22.4' +
      '\n2026-07-16 08:30,abc,22.9,8,34.3,42,1507,22.4';
    const result = parseCsvText(text);
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(3);
  });
});

describe('dedupeByDateKey', () => {
  it('既存と分単位で同日時の行はスキップされる', () => {
    // 既存はISO秒つき、CSV由来は分単位 → キー正規化で一致すること
    const existing = [rec('2026-07-15T08:30:45.000Z')];
    const parsed = parseCsvText(toCsv(existing));
    const { fresh, skipped } = dedupeByDateKey(parsed.records, existing);
    expect(fresh).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('新規の行だけが fresh に残る', () => {
    const existing = [rec('2026-07-15T08:30:00.000Z')];
    const incoming = parseCsvText(
      toCsv([rec('2026-07-15T08:30:00.000Z'), rec('2026-07-14T08:00:00.000Z')])
    ).records;
    const { fresh, skipped } = dedupeByDateKey(incoming, existing);
    expect(fresh).toHaveLength(1);
    expect(formatDate(fresh[0].measuredAt)).toBe(formatDate('2026-07-14T08:00:00.000Z'));
    expect(skipped).toBe(1);
  });

  it('CSV内部の同日時重複も1件にまとめる', () => {
    const text =
      HEADER_LINE +
      '\n2026-07-15 08:30,63.4,22.9,8,34.3,42,1507,22.4' +
      '\n2026-07-15 08:30,63.4,22.9,8,34.3,42,1507,22.4';
    const { records } = parseCsvText(text);
    const { fresh, skipped } = dedupeByDateKey(records, []);
    expect(fresh).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('既存が空なら全件 fresh', () => {
    const { records } = parseCsvText(
      HEADER_LINE + '\n2026-07-15 08:30,63.4,22.9,8,34.3,42,1507,22.4'
    );
    const { fresh, skipped } = dedupeByDateKey(records, []);
    expect(fresh).toHaveLength(1);
    expect(skipped).toBe(0);
  });
});
