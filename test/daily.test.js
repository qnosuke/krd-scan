import { describe, it, expect } from 'vitest';
import { dateKeyOf, groupByDay, dailyLatest } from '../src/daily.js';

// listMeasurements() と同じく新しい順で渡す
const rec = (measuredAt, weight) => ({ measuredAt, weight });

describe('dateKeyOf', () => {
  it('ISO文字列をローカル日付キーにする', () => {
    // ローカルタイムゾーン依存を避けるためローカル時刻表記で検証
    expect(dateKeyOf('2026-07-17T07:30:00')).toBe('2026-07-17');
  });

  it('不正な日時は null', () => {
    expect(dateKeyOf('not-a-date')).toBeNull();
  });
});

describe('groupByDay', () => {
  it('同じ日の複数測定を1グループにまとめ、latest はその日の最新', () => {
    const records = [
      rec('2026-07-17T21:00:00', '63.4'),
      rec('2026-07-17T07:30:00', '64.0'),
      rec('2026-07-16T07:30:00', '63.8'),
    ];
    const groups = groupByDay(records);
    expect(groups.length).toBe(2);
    expect(groups[0].dateKey).toBe('2026-07-17');
    expect(groups[0].records.length).toBe(2);
    expect(groups[0].latest.weight).toBe('63.4');
    expect(groups[1].dateKey).toBe('2026-07-16');
    expect(groups[1].records.length).toBe(1);
  });

  it('新しい日順で返す', () => {
    const records = [rec('2026-07-17T08:00:00', '63.4'), rec('2026-07-15T08:00:00', '64.0')];
    expect(groupByDay(records).map((g) => g.dateKey)).toEqual(['2026-07-17', '2026-07-15']);
  });

  it('不正な日時のレコードは無視する', () => {
    const records = [rec('2026-07-17T08:00:00', '63.4'), rec('broken', '99')];
    const groups = groupByDay(records);
    expect(groups.length).toBe(1);
    expect(groups[0].records.length).toBe(1);
  });

  it('空・null は空配列', () => {
    expect(groupByDay([])).toEqual([]);
    expect(groupByDay(null)).toEqual([]);
  });
});

describe('dailyLatest', () => {
  it('1日1レコード（その日の最新）に間引く', () => {
    const records = [
      rec('2026-07-17T21:00:00', '63.4'),
      rec('2026-07-17T07:30:00', '64.0'),
      rec('2026-07-16T07:30:00', '63.8'),
    ];
    const latest = dailyLatest(records);
    expect(latest.length).toBe(2);
    expect(latest[0].weight).toBe('63.4');
    expect(latest[1].weight).toBe('63.8');
  });

  it('空なら空配列', () => {
    expect(dailyLatest([])).toEqual([]);
  });
});
