import { describe, it, expect } from 'vitest';
import { computeDelta, previousValue, formatDelta } from '../src/trend.js';

const rec = (measuredAt, weight) => ({ measuredAt, weight });

describe('computeDelta', () => {
  it('最新と前回の差を返す', () => {
    const records = [rec('2026-07-15', '62.7'), rec('2026-07-14', '63.2')];
    expect(computeDelta(records, 'weight')).toBeCloseTo(-0.5);
  });

  it('値がnullの記録は飛ばして次に古い値と比較する', () => {
    const records = [rec('2026-07-15', '62.7'), rec('2026-07-14', null), rec('2026-07-13', '63.0')];
    expect(computeDelta(records, 'weight')).toBeCloseTo(-0.3);
  });

  it('記録が1件だけなら null', () => {
    expect(computeDelta([rec('2026-07-15', '62.7')], 'weight')).toBeNull();
  });

  it('最新の記録にその項目の値がなければ null', () => {
    const records = [rec('2026-07-15', null), rec('2026-07-14', '63.0')];
    expect(computeDelta(records, 'weight')).toBeNull();
  });

  it('index指定でそのレコード基準の前回比を計算する', () => {
    const records = [rec('2026-07-15', '62.7'), rec('2026-07-14', '63.2'), rec('2026-07-13', '63.0')];
    expect(computeDelta(records, 'weight', 1)).toBeCloseTo(0.2);
  });
});

describe('previousValue', () => {
  it('値がある直近のレコードの数値を返す', () => {
    const records = [rec('2026-07-15', null), rec('2026-07-14', '63.0')];
    expect(previousValue(records, 'weight')).toBe(63.0);
  });

  it('どのレコードにも値がなければ null', () => {
    expect(previousValue([rec('2026-07-15', null)], 'weight')).toBeNull();
    expect(previousValue([], 'weight')).toBeNull();
  });
});

describe('formatDelta', () => {
  it('増加は▲、減少は▼、ゼロは±0', () => {
    expect(formatDelta(0.3, 1)).toBe('▲0.3');
    expect(formatDelta(-0.5, 1)).toBe('▼0.5');
    expect(formatDelta(0, 1)).toBe('±0');
  });

  it('丸めるとゼロになる差は±0（浮動小数の揺れを吸収）', () => {
    expect(formatDelta(0.04, 1)).toBe('±0');
    expect(formatDelta(63.0 - 62.999999, 1)).toBe('±0');
  });

  it('整数項目は小数なしで表示', () => {
    expect(formatDelta(2, 0)).toBe('▲2');
    expect(formatDelta(-1, 0)).toBe('▼1');
  });

  it('null は null', () => {
    expect(formatDelta(null)).toBeNull();
  });
});
