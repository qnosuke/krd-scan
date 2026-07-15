// 推移グラフの座標計算（純関数・DOMに触らない）。
// records は db.js listMeasurements() の戻り値（新しい順）を受け取り、古い順に並べて使う。
// SVGの構築は ui/historyView.js 側で行う。

export const PERIODS = [
  { key: '1m', label: '1ヶ月', days: 31 },
  { key: '3m', label: '3ヶ月', days: 92 },
  { key: 'all', label: '全部', days: Infinity },
];

export const CHART_W = 340;
export const CHART_H = 170;
export const PAD = { left: 44, right: 14, top: 18, bottom: 22 };

// 点が多いと iPhone 幅では潰れるので等間隔に間引く（先頭・末尾は必ず残す）
const MAX_POINTS = 60;

export function buildChart(records, key, { days = Infinity, now = Date.now(), decimals = 1 } = {}) {
  const cutoff = days === Infinity ? -Infinity : now - days * 86400000;
  let pts = [];
  for (const r of records ?? []) {
    const raw = r?.[key];
    if (raw == null || raw === '') continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const t = new Date(r.measuredAt).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    pts.push({ t, v });
  }
  pts.sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;

  if (pts.length > MAX_POINTS) {
    const step = (pts.length - 1) / (MAX_POINTS - 1);
    pts = Array.from({ length: MAX_POINTS }, (_, i) => pts[Math.round(i * step)]);
  }

  const t0 = pts[0].t;
  const tSpan = pts[pts.length - 1].t - t0 || 1;
  const dataMin = Math.min(...pts.map((p) => p.v));
  const dataMax = Math.max(...pts.map((p) => p.v));
  // 上下に1割の余白。全点同値でも高さが出るよう最低幅を確保
  const span = dataMax - dataMin;
  const margin = span > 0 ? span * 0.1 : Math.max(Math.abs(dataMax) * 0.02, 1);
  const vMin = dataMin - margin;
  const vMax = dataMax + margin;

  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const x = (t) => PAD.left + ((t - t0) / tSpan) * innerW;
  const y = (v) => PAD.top + (1 - (v - vMin) / (vMax - vMin)) * innerH;

  const points = pts.map((p) => ({ x: x(p.t), y: y(p.v), value: p.v, t: p.t }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const fmt = (v) => v.toFixed(decimals);
  const tickVals = span > 0 ? [dataMax, (dataMin + dataMax) / 2, dataMin] : [dataMin];
  const yTicks = tickVals.map((v) => ({ y: y(v), label: fmt(v) }));

  const fmtDate = (t) => {
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const first = points[0];
  const last = points[points.length - 1];
  const xLabels = [
    { x: first.x, label: fmtDate(first.t), anchor: 'start' },
    { x: last.x, label: fmtDate(last.t), anchor: 'end' },
  ];

  return {
    width: CHART_W,
    height: CHART_H,
    points,
    path,
    yTicks,
    xLabels,
    latest: { ...last, label: fmt(last.value) },
  };
}
