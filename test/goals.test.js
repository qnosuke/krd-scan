import { describe, it, expect } from 'vitest';
import { GOAL_KEYS, loadGoals, saveGoals, goalStatus, formatGoalStatus } from '../src/goals.js';

// node 環境には localStorage がないので Map ベースのフェイクを注入する
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

describe('loadGoals / saveGoals', () => {
  it('未保存なら空オブジェクト', () => {
    expect(loadGoals(fakeStorage())).toEqual({});
  });

  it('保存して読み戻せる（文字列のまま）', () => {
    const s = fakeStorage();
    saveGoals({ weight: '63.0', bodyFat: '20.0' }, s);
    expect(loadGoals(s)).toEqual({ weight: '63.0', bodyFat: '20.0' });
  });

  it('片方だけの保存も可', () => {
    const s = fakeStorage();
    saveGoals({ weight: '63.0' }, s);
    expect(loadGoals(s)).toEqual({ weight: '63.0' });
  });

  it('壊れたJSONは空扱い', () => {
    const s = fakeStorage();
    s.setItem('krdscan-goals', '{oops');
    expect(loadGoals(s)).toEqual({});
  });

  it('オブジェクトでないJSON・数値化できない値・知らないキーは捨てる', () => {
    const s = fakeStorage();
    s.setItem('krdscan-goals', '[1,2]');
    expect(loadGoals(s)).toEqual({});
    s.setItem('krdscan-goals', JSON.stringify({ weight: 'abc', bmi: '22', bodyFat: '20.0' }));
    expect(loadGoals(s)).toEqual({ bodyFat: '20.0' });
  });

  it('空オブジェクトの保存はキーごと削除', () => {
    const s = fakeStorage();
    saveGoals({ weight: '63.0' }, s);
    saveGoals({}, s);
    expect(s._map.has('krdscan-goals')).toBe(false);
  });

  it('空文字・nullの項目は保存しない', () => {
    const s = fakeStorage();
    saveGoals({ weight: '', bodyFat: null }, s);
    expect(s._map.has('krdscan-goals')).toBe(false);
  });

  it('storage が例外を投げても落ちない', () => {
    const broken = {
      getItem() { throw new Error('nope'); },
      setItem() { throw new Error('nope'); },
      removeItem() { throw new Error('nope'); },
    };
    expect(loadGoals(broken)).toEqual({});
    expect(() => saveGoals({ weight: '63.0' }, broken)).not.toThrow();
  });
});

describe('goalStatus（達成 = 最新値 ≦ 目標値）', () => {
  it('未達: diff が正、achieved false', () => {
    expect(goalStatus('63.4', '63.0')).toEqual({ diff: expect.closeTo(0.4), achieved: false });
  });

  it('達成: diff が負、achieved true', () => {
    expect(goalStatus('20.5', '22.0')).toEqual({ diff: expect.closeTo(-1.5), achieved: true });
  });

  it('同値ちょうどは達成', () => {
    expect(goalStatus('63.0', '63.0')).toEqual({ diff: 0, achieved: true });
  });

  it('数値でも受け付ける（previousValue の戻り値は number）', () => {
    expect(goalStatus(63.4, '63.0')).toEqual({ diff: expect.closeTo(0.4), achieved: false });
  });

  it('どちらかが null・空・非数値なら null', () => {
    expect(goalStatus(null, '63.0')).toBeNull();
    expect(goalStatus('63.4', null)).toBeNull();
    expect(goalStatus('', '63.0')).toBeNull();
    expect(goalStatus('63.4', 'abc')).toBeNull();
  });
});

describe('formatGoalStatus', () => {
  const kg = { unit: 'kg', decimals: 1 };

  it('未達は「あと N」', () => {
    expect(formatGoalStatus({ diff: 0.4, achieved: false }, kg)).toBe('あと 0.4kg');
  });

  it('達成は「🎉 達成！（−N）」', () => {
    expect(formatGoalStatus({ diff: -1.5, achieved: true }, { unit: '%', decimals: 1 })).toBe('🎉 達成！（−1.5%）');
  });

  it('同値達成は「🎉 達成！（±0）」', () => {
    expect(formatGoalStatus({ diff: 0, achieved: true }, kg)).toBe('🎉 達成！（±0）');
  });

  it('丸めてゼロになる差も ±0（浮動小数の揺れを吸収）', () => {
    expect(formatGoalStatus({ diff: -0.04, achieved: true }, kg)).toBe('🎉 達成！（±0）');
  });

  it('null は null', () => {
    expect(formatGoalStatus(null, kg)).toBeNull();
  });
});

describe('GOAL_KEYS', () => {
  it('体重と体脂肪率のみ', () => {
    expect(GOAL_KEYS).toEqual(['weight', 'bodyFat']);
  });
});
