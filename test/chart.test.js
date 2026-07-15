import { describe, it, expect } from 'vitest';
import { buildChart, PERIODS, CHART_W, CHART_H, PAD } from '../src/chart.js';

const DAY = 86400000;
const T0 = new Date('2026-07-01T07:00:00').getTime();
const rec = (dayOffset, weight) => ({
  measuredAt: new Date(T0 + dayOffset * DAY).toISOString(),
  weight,
});

describe('buildChart', () => {
  it('有効な点が2つ未満なら null', () => {
    expect(buildChart([], 'weight', {})).toBeNull();
    expect(buildChart([rec(0, '62.7')], 'weight', {})).toBeNull();
    expect(buildChart([rec(1, null), rec(0, '62.7')], 'weight', {})).toBeNull();
  });

  it('新しい順の入力を古い順の点列にし、描画パスを返す', () => {
    const chart = buildChart([rec(2, '62.7'), rec(1, '63.0'), rec(0, '63.2')], 'weight', {});
    expect(chart.points).toHaveLength(3);
    expect(chart.points[0].value).toBe(63.2);
    expect(chart.points[2].value).toBe(62.7);
    expect(chart.path.startsWith('M')).toBe(true);
    expect(chart.width).toBe(CHART_W);
    expect(chart.height).toBe(CHART_H);
  });

  it('点はパディング内に収まり、値が大きいほど y が小さい', () => {
    const chart = buildChart([rec(1, '64.0'), rec(0, '62.0')], 'weight', {});
    const [p62, p64] = chart.points;
    expect(p64.y).toBeLessThan(p62.y);
    for (const p of chart.points) {
      expect(p.x).toBeGreaterThanOrEqual(PAD.left);
      expect(p.x).toBeLessThanOrEqual(CHART_W - PAD.right);
      expect(p.y).toBeGreaterThanOrEqual(PAD.top);
      expect(p.y).toBeLessThanOrEqual(CHART_H - PAD.bottom);
    }
  });

  it('days で期間を絞り込む', () => {
    const now = T0 + 100 * DAY;
    const records = [rec(99, '62.0'), rec(98, '62.5'), rec(1, '70.0')];
    const chart = buildChart(records, 'weight', { days: 31, now });
    expect(chart.points).toHaveLength(2);
    expect(chart.points.every((p) => p.value < 63)).toBe(true);
  });

  it('全点同値でも NaN を出さない（yTicksは1本になる）', () => {
    const chart = buildChart([rec(1, '62.7'), rec(0, '62.7')], 'weight', {});
    for (const p of chart.points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(chart.yTicks).toHaveLength(1);
  });

  it('同時刻の2点でも x が NaN にならない', () => {
    const chart = buildChart([rec(0, '62.7'), rec(0, '63.0')], 'weight', {});
    for (const p of chart.points) expect(Number.isFinite(p.x)).toBe(true);
  });

  it('点数が多いときは60点以下に間引かれ、先頭と末尾は残る', () => {
    const records = [];
    for (let i = 0; i < 200; i++) records.push(rec(i, String(60 + (i % 10) / 10)));
    const chart = buildChart(records, 'weight', {});
    expect(chart.points.length).toBeLessThanOrEqual(60);
    expect(chart.points[0].t).toBe(new Date(records[0].measuredAt).getTime());
    expect(chart.points.at(-1).t).toBe(new Date(records[199].measuredAt).getTime());
  });

  it('最新点に decimals どおりのラベルが付く', () => {
    const chart = buildChart([rec(1, '62.7'), rec(0, '63.0')], 'weight', { decimals: 1 });
    expect(chart.latest.label).toBe('62.7');
    // rec() は weight キーにしか値を入れないので、別キーはどの記録にも値が無く null
    const c0 = buildChart([rec(1, '1507'), rec(0, '1512')], 'basalMetabolism', { decimals: 0 });
    expect(c0).toBeNull();
  });

  it('yTicks は最大値・中間・最小値の3本（データ値でラベル）', () => {
    const chart = buildChart([rec(1, '64.0'), rec(0, '62.0')], 'weight', { decimals: 1 });
    expect(chart.yTicks.map((t) => t.label)).toEqual(['64.0', '63.0', '62.0']);
  });

  it('xLabels は最初と最後の日付（M/D）', () => {
    const chart = buildChart([rec(3, '62.7'), rec(0, '63.0')], 'weight', {});
    expect(chart.xLabels).toHaveLength(2);
    expect(chart.xLabels[0].label).toBe('7/1');
    expect(chart.xLabels[1].label).toBe('7/4');
    expect(chart.xLabels[0].anchor).toBe('start');
    expect(chart.xLabels[1].anchor).toBe('end');
  });

  it('PERIODS の定義', () => {
    expect(PERIODS.map((p) => p.key)).toEqual(['1m', '3m', 'all']);
    expect(PERIODS[0].days).toBe(31);
    expect(PERIODS[2].days).toBe(Infinity);
  });
});
