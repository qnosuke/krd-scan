import { describe, it, expect } from 'vitest';
import { toCsv } from '../src/csv.js';

const records = [
  {
    id: 2,
    measuredAt: '2026-07-13T08:30:00.000Z',
    weight: '62.5',
    bodyFat: '15.6',
    visceralFat: '4',
    skeletalMuscle: '40.1',
    bodyAge: '21',
    basalMetabolism: '1540',
    bmi: '20.1',
  },
  {
    id: 1,
    measuredAt: '2026-07-12T08:30:00.000Z',
    weight: '62.7',
    bodyFat: null, // 読み取れなかった項目は空欄
    visceralFat: '4',
    skeletalMuscle: '39.9',
    bodyAge: '22',
    basalMetabolism: '1545',
    bmi: '20.2',
  },
];

describe('toCsv', () => {
  const csv = toCsv(records);
  const lines = csv.trimEnd().split('\r\n');

  it('ヘッダー行がある', () => {
    expect(lines[0]).toBe('日時,体重(kg),体脂肪率(%),内臓脂肪(Lv),骨格筋率(%),体年齢(才),基礎代謝(kcal),BMI');
  });

  it('古い順に並ぶ', () => {
    expect(lines[1]).toContain('62.7');
    expect(lines[2]).toContain('62.5');
  });

  it('未計測はの空欄になる', () => {
    const cells = lines[1].split(',');
    expect(cells[2]).toBe(''); // 体脂肪率
  });

  it('CRLFで終端する', () => {
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
