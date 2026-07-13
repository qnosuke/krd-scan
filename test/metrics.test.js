import { describe, it, expect } from 'vitest';
import { METRICS, matchesMetric, metricByKey, validateInput } from '../src/metrics.js';

describe('matchesMetric', () => {
  const weight = metricByKey('weight');
  const bodyFat = metricByKey('bodyFat');
  const visceral = metricByKey('visceralFat');
  const bodyAge = metricByKey('bodyAge');
  const basal = metricByKey('basalMetabolism');
  const bmi = metricByKey('bmi');

  it('体重は小数1桁が必須', () => {
    expect(matchesMetric('62.7', weight)).toBe(true);
    expect(matchesMetric('62', weight)).toBe(false);
    expect(matchesMetric('135.4', weight)).toBe(true);
    expect(matchesMetric('135.6', weight)).toBe(false);
  });

  it('整数項目は小数を受け付けない', () => {
    expect(matchesMetric('4', visceral)).toBe(true);
    expect(matchesMetric('4.0', visceral)).toBe(false);
    expect(matchesMetric('22', bodyAge)).toBe(true);
    expect(matchesMetric('1545', basal)).toBe(true);
  });

  it('レンジ外は不一致', () => {
    expect(matchesMetric('4.9', bodyFat)).toBe(false);
    expect(matchesMetric('50.1', bodyFat)).toBe(false);
    expect(matchesMetric('31', visceral)).toBe(false);
    expect(matchesMetric('17', bodyAge)).toBe(false);
    expect(matchesMetric('384', basal)).toBe(false);
  });

  it('不正な文字列は不一致', () => {
    expect(matchesMetric('abc', bmi)).toBe(false);
    expect(matchesMetric('', bmi)).toBe(false);
    expect(matchesMetric('20.25', bmi)).toBe(false);
  });

  it('7項目が定義されている', () => {
    expect(METRICS).toHaveLength(7);
  });
});

describe('validateInput（手入力の検証）', () => {
  const bmi = metricByKey('bmi');
  it('空は未計測として許容', () => {
    expect(validateInput('', bmi)).toBe(true);
    expect(validateInput(null, bmi)).toBe(true);
  });
  it('値が入っていればレンジ検証', () => {
    expect(validateInput('20.2', bmi)).toBe(true);
    expect(validateInput('999.9', bmi)).toBe(false);
  });
});
