# UI刷新（ライトテーマ）+ 推移グラフ・前回比表示 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KRD scan を実機（白ボディ+淡い液晶）に近いライトテーマに刷新し、履歴タブに最新値サマリー（前回比つき）と7項目切替の推移グラフを追加、確認画面に前回値を表示する。

**Architecture:** CSS変数の差し替えで全画面をライトテーマ化。グラフは依存ゼロの自作インラインSVG（座標計算は純関数 `src/chart.js`、DOM構築は `historyView.js`）。前回比計算は純関数 `src/trend.js` に置き、履歴タブと確認画面で共用する。

**Tech Stack:** Vanilla JS + Vite + vite-plugin-pwa、vitest（environment: node）。外部ライブラリ追加なし。

**Spec:** `docs/superpowers/specs/2026-07-15-ui-refresh-graphs-design.md`

## Global Constraints

- 外部ライブラリ・外部送信・トラッキングを追加しない（情報タブのプライバシー約束を維持）
- IndexedDB名 'karadascan'、DBスキーマ、`src/sevenseg.js`、`src/session.js` には触らない
- 記録の値は**文字列**で保存されている（`"62.7"` など、未計測は `null`）。`listMeasurements()` は**新しい順**で返す
- 前回比は色分けしない（▲/▼/±0 のニュートラル表示）
- グラフ: 単一系列なので凡例なし。線2px・グリッドとY軸ラベルは控えめ（--panel-2 / --text-dim）・値ラベルの文字色はテキスト色（系列色の文字は使わない）・タップ等のインタラクションは作らない
- 動画ファイル `IMG_*.MOV` は絶対にコミットしない
- コミットメッセージは日本語、末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

- Create: `src/trend.js` — 前回値・前回比の純関数
- Create: `src/chart.js` — グラフ座標計算の純関数（DOMに触らない）
- Create: `test/trend.test.js`, `test/chart.test.js`
- Modify: `src/styles.css` — 全面改訂（ライトテーマ+新コンポーネント）
- Modify: `index.html` — theme-colorメタ・ステータスバー・履歴セクションにサマリー/グラフ用DOM追加
- Modify: `vite.config.js` — manifest の theme_color / background_color
- Modify: `src/ui/historyView.js` — サマリーカード+グラフ描画を追加
- Modify: `src/ui/confirmView.js` — 前回値の薄表示を追加

---

### Task 1: trend.js（前回値・前回比の純関数）

**Files:**
- Create: `src/trend.js`
- Test: `test/trend.test.js`

**Interfaces:**
- Consumes: なし（レコード配列は `listMeasurements()` 形式 = 新しい順、値は文字列 or null）
- Produces:
  - `previousValue(records, key, startIndex = 0): number | null` — startIndex以降で最初に値がある記録の数値
  - `computeDelta(records, key, index = 0): number | null` — records[index] と、それより古い直近の値との差
  - `formatDelta(delta, decimals = 1): string | null` — `"▲0.3"` / `"▼0.5"` / `"±0"`、delta が null なら null

- [ ] **Step 1: 失敗するテストを書く**

`test/trend.test.js`:

```js
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
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run test/trend.test.js`
Expected: FAIL（`src/trend.js` が存在しない）

- [ ] **Step 3: 実装**

`src/trend.js`:

```js
// 前回値・前回比の計算（純関数）。
// records は db.js listMeasurements() の戻り値（新しい順）を想定。
// 値は文字列のまま保存されている（"62.7" など。未計測は null）。

function numeric(record, key) {
  const raw = record?.[key];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** startIndex 以降で最初にその項目の値を持つレコードの数値。無ければ null */
export function previousValue(records, key, startIndex = 0) {
  for (let i = startIndex; i < records.length; i++) {
    const v = numeric(records[i], key);
    if (v != null) return v;
  }
  return null;
}

/** records[index] の値と、それより古い直近の値との差。どちらかが欠けていれば null */
export function computeDelta(records, key, index = 0) {
  const cur = numeric(records[index], key);
  if (cur == null) return null;
  const prev = previousValue(records, key, index + 1);
  if (prev == null) return null;
  return cur - prev;
}

/** 「▲0.3」「▼0.5」「±0」形式。増減の良し悪しは項目で逆なので色や評価は付けない */
export function formatDelta(delta, decimals = 1) {
  if (delta == null) return null;
  const rounded = Number(delta.toFixed(decimals));
  if (rounded > 0) return `▲${rounded.toFixed(decimals)}`;
  if (rounded < 0) return `▼${Math.abs(rounded).toFixed(decimals)}`;
  return '±0';
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/trend.test.js`
Expected: PASS（12件）

- [ ] **Step 5: 既存テストも全部通ることを確認してコミット**

Run: `npm test`
Expected: 全件PASS（既存59件 + 12件）

```bash
git add src/trend.js test/trend.test.js
git commit -m "前回値・前回比計算の純関数 trend.js を追加"
```

---

### Task 2: chart.js（グラフ座標計算の純関数）

**Files:**
- Create: `src/chart.js`
- Test: `test/chart.test.js`

**Interfaces:**
- Consumes: レコード配列（`listMeasurements()` 形式）
- Produces:
  - `PERIODS: [{key:'1m',label:'1ヶ月',days:31},{key:'3m',label:'3ヶ月',days:92},{key:'all',label:'全部',days:Infinity}]`
  - `CHART_W = 340`, `CHART_H = 170`, `PAD = { left: 44, right: 14, top: 18, bottom: 22 }`
  - `buildChart(records, key, { days, now, decimals }): null | { width, height, points: [{x,y,value,t}], path: string, yTicks: [{y,label}], xLabels: [{x,label,anchor}], latest: {x,y,value,t,label} }`
  - 有効な点が2つ未満なら null（呼び出し側が空メッセージを出す）

- [ ] **Step 1: 失敗するテストを書く**

`test/chart.test.js`:

```js
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
    const c0 = buildChart([rec(1, '1507'), rec(0, '1512')], 'basalMetabolism', { decimals: 0 });
    expect(c0).toBeNull(); // basalMetabolism キーの値が無いので null（キー名に注意）
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
```

補足: 「decimals どおりのラベル」の2つ目のアサートは、`rec()` ヘルパが weight キーにしか値を入れないことを利用して「対象キーに値がなければ null」を再確認している（basalMetabolism の値はどのレコードにも無い）。

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run test/chart.test.js`
Expected: FAIL（`src/chart.js` が存在しない）

- [ ] **Step 3: 実装**

`src/chart.js`:

```js
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/chart.test.js`
Expected: PASS（11件）

- [ ] **Step 5: 全テスト実行してコミット**

Run: `npm test`
Expected: 全件PASS

```bash
git add src/chart.js test/chart.test.js
git commit -m "推移グラフの座標計算 chart.js を追加"
```

---

### Task 3: ライトテーマへの全面刷新

**Files:**
- Modify: `src/styles.css`（全面書き換え。下のコードで**丸ごと置き換える**）
- Modify: `index.html:6-8`（theme-color と status-bar-style）
- Modify: `vite.config.js:20-21`（manifest の色）

**Interfaces:**
- Consumes: なし
- Produces: 後続タスクが使うCSSクラス — `.summary-card` `.summary-grid` `.summary-cell(.main)` `.trend-card` `.trend-periods` `.trend-period(.selected)` `.chip.selected` `.trend-chart` `.trend-empty` `.confirm-row .label-wrap` `.confirm-row .prev`。CSS変数 `--lcd-bg` `--lcd-border` `--lcd-text` `--accent-dark` `--panel-2` `--text-dim`（SVG属性からも `var(...)` で参照する）

- [ ] **Step 1: styles.css を丸ごと置き換える**

`src/styles.css` 全文:

```css
:root {
  --bg: #f3f2ee;          /* 実機の白ボディをイメージした暖かみのある薄グレー */
  --panel: #ffffff;
  --panel-2: #e4e2da;     /* 枠線・区切り・グラフのグリッド線 */
  --text: #2c3136;
  --text-dim: #6d7378;
  --accent: #2f8f83;      /* 落ち着いた青緑。グラフの線・枠線類 */
  --accent-dark: #23756b; /* ボタン・アクティブ表示（白文字が載る） */
  --ok: #3d8b57;
  --danger: #c94f46;
  --lcd-bg: #e3e9d9;      /* 液晶風の淡いグレーグリーン */
  --lcd-border: #c9d3bd;
  --lcd-text: #2f4433;    /* 液晶の濃い文字色 */
  --shadow: 0 1px 3px rgba(70, 74, 66, 0.1);
  --radius: 14px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}

#app {
  padding: max(env(safe-area-inset-top), 12px) 16px calc(72px + env(safe-area-inset-bottom));
  max-width: 480px;
  margin: 0 auto;
}

.view h2 { font-size: 1.2rem; margin: 8px 0 4px; }
.note { color: var(--text-dim); font-size: 0.85rem; margin-bottom: 12px; }

/* ---- 計測画面 ---- */
.camera-wrap {
  position: relative;
  border-radius: var(--radius);
  overflow: hidden;
  background: #000;
  aspect-ratio: 3 / 4;
}
#camera-video { width: 100%; height: 100%; object-fit: cover; }

.guide-frame {
  position: absolute;
  left: 10%; right: 10%;
  top: 32%; height: 24%;
  border: 3px solid #ffc94d; /* 暗い映像の上でも見えるよう琥珀色 */
  border-radius: 10px;
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35);
  display: flex; align-items: flex-end; justify-content: center;
}
.guide-hint {
  color: #fff; font-size: 0.75rem; text-align: center;
  transform: translateY(2.2em);
  text-shadow: 0 1px 3px #000;
}
.capture-status {
  position: absolute;
  bottom: 8px; left: 0; right: 0;
  text-align: center;
  color: #fff; font-size: 0.85rem;
  text-shadow: 0 1px 3px #000;
}

.metric-chips {
  display: flex; flex-wrap: wrap; gap: 8px;
  margin: 14px 0;
  min-height: 36px;
}
.chip {
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--panel);
  color: var(--text-dim);
  font-size: 0.8rem;
  font-family: inherit;
  border: 1px solid var(--panel-2);
}
.chip.done {
  background: var(--lcd-bg);
  color: var(--lcd-text);
  border-color: var(--lcd-border);
  font-variant-numeric: tabular-nums;
}
button.chip { cursor: pointer; }
.chip.selected {
  background: var(--accent-dark);
  border-color: var(--accent-dark);
  color: #fff;
  font-weight: 600;
}

.capture-actions, .confirm-actions, .history-actions {
  display: flex; flex-direction: column; gap: 10px; margin-top: 8px;
}

/* ---- ボタン ---- */
.btn {
  appearance: none;
  border: 1px solid var(--panel-2);
  background: var(--panel);
  color: var(--text);
  font-size: 1rem;
  padding: 14px;
  border-radius: var(--radius);
  cursor: pointer;
  box-shadow: var(--shadow);
}
.btn.primary {
  background: var(--accent-dark);
  border-color: var(--accent-dark);
  color: #fff;
  font-weight: 600;
}
.btn.danger-text { background: none; border: none; box-shadow: none; color: var(--danger); }
.btn:active { opacity: 0.8; }
.btn[hidden] { display: none; }

/* ---- 確認画面 ---- */
.confirm-list { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.confirm-row {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--panel);
  border-radius: var(--radius);
  padding: 12px 16px;
  box-shadow: var(--shadow);
}
.confirm-row .label-wrap { display: flex; flex-direction: column; gap: 2px; }
.confirm-row .label { color: var(--text-dim); font-size: 0.9rem; }
.confirm-row .prev { color: var(--text-dim); font-size: 0.72rem; }
.confirm-row input {
  width: 7em;
  text-align: right;
  font-size: 1.2rem;
  font-variant-numeric: tabular-nums;
  background: none; border: none; color: var(--lcd-text);
  border-bottom: 1px dashed var(--panel-2);
  outline: none;
}
.confirm-row input:focus { border-bottom-color: var(--accent); }
.confirm-row .unit { color: var(--text-dim); font-size: 0.8rem; width: 3em; }
.confirm-row.missing input { border-bottom-color: var(--danger); }

/* ---- 履歴画面: サマリーカード ---- */
.summary-card {
  background: var(--panel);
  border-radius: var(--radius);
  padding: 14px 16px;
  box-shadow: var(--shadow);
  margin: 12px 0;
}
.summary-card .date { color: var(--text-dim); font-size: 0.8rem; }
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px 8px;
  margin-top: 10px;
}
.summary-cell .label { display: block; color: var(--text-dim); font-size: 0.72rem; }
.summary-cell .value {
  color: var(--lcd-text);
  font-size: 1.05rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.summary-cell .unit { color: var(--text-dim); font-size: 0.7rem; margin-left: 2px; }
.summary-cell .delta { color: var(--text-dim); font-size: 0.75rem; margin-left: 6px; }
.summary-cell.main { grid-column: 1 / -1; }
.summary-cell.main .value {
  display: inline-block;
  font-size: 1.9rem;
  background: var(--lcd-bg);
  border: 1px solid var(--lcd-border);
  border-radius: 10px;
  padding: 2px 14px;
}

/* ---- 履歴画面: 推移グラフ ---- */
.trend-card {
  background: var(--panel);
  border-radius: var(--radius);
  padding: 14px 16px;
  box-shadow: var(--shadow);
  margin-bottom: 12px;
}
.trend-card .metric-chips { margin: 0 0 8px; min-height: 0; }
.trend-periods { display: flex; gap: 6px; margin-bottom: 6px; }
.trend-period {
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--panel-2);
  background: none;
  color: var(--text-dim);
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
}
.trend-period.selected {
  background: var(--accent-dark);
  border-color: var(--accent-dark);
  color: #fff;
  font-weight: 600;
}
.trend-chart svg { width: 100%; height: auto; display: block; }
.trend-empty { color: var(--text-dim); font-size: 0.85rem; text-align: center; padding: 24px 0; }

/* ---- 履歴画面: リスト ---- */
.history-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.history-item {
  background: var(--panel);
  border-radius: var(--radius);
  padding: 12px 16px;
  box-shadow: var(--shadow);
}
.history-item .date { color: var(--text-dim); font-size: 0.8rem; }
.history-item .values {
  display: flex; flex-wrap: wrap; gap: 4px 14px;
  margin-top: 6px;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}
.history-item .delete {
  background: none; border: none; color: var(--danger);
  font-size: 0.8rem; margin-top: 8px; cursor: pointer; padding: 4px 0;
}
.history-empty { color: var(--text-dim); text-align: center; padding: 32px 0; }

/* ---- 取り込み画面 ---- */
.file-drop {
  display: block;
  border: 2px dashed var(--panel-2);
  border-radius: var(--radius);
  padding: 28px;
  text-align: center;
  color: var(--text-dim);
  background: var(--panel);
  margin-bottom: 12px;
}
.file-drop input { display: none; }
.import-preview video, .import-preview canvas {
  width: 100%; border-radius: var(--radius);
}
#view-import .capture-status { position: static; margin: 8px 0; text-shadow: none; color: var(--text-dim); }

/* ---- 情報画面 ---- */
#view-about h3 { font-size: 1rem; margin: 18px 0 6px; color: var(--accent-dark); }
.about-text { color: var(--text-dim); font-size: 0.9rem; line-height: 1.7; }
.about-list {
  list-style: none;
  display: flex; flex-direction: column; gap: 8px;
}
.about-list li {
  background: var(--panel);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: 0.85rem;
  line-height: 1.7;
  color: var(--text-dim);
  box-shadow: var(--shadow);
}
.about-list strong { color: var(--text); }
#view-about a { color: var(--accent-dark); }
.bmc-link {
  display: block;
  margin-top: 10px;
  padding: 14px;
  border-radius: var(--radius);
  background: #ffdd00;
  color: #2c3136 !important;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
}

/* ---- タブバー ---- */
.tab-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  display: flex;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  border-top: 1px solid var(--panel-2);
  padding-bottom: env(safe-area-inset-bottom);
}
.tab {
  flex: 1;
  background: none; border: none;
  color: var(--text-dim);
  font-size: 0.9rem;
  padding: 14px 0;
  cursor: pointer;
}
.tab.active { color: var(--accent-dark); font-weight: 600; }
```

- [ ] **Step 2: index.html のメタを更新**

`index.html` の6〜8行目を変更:

変更前:
```html
  <meta name="theme-color" content="#0f172a" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

変更後（ライト背景に白文字ステータスバーは読めないので default に変更）:
```html
  <meta name="theme-color" content="#f3f2ee" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

- [ ] **Step 3: vite.config.js の manifest 色を更新**

変更前:
```js
        background_color: '#0f172a',
        theme_color: '#0f172a',
```

変更後:
```js
        background_color: '#f3f2ee',
        theme_color: '#f3f2ee',
```

- [ ] **Step 4: テストとビルドを確認**

Run: `npm test && npm run build`
Expected: テスト全件PASS、ビルド成功

- [ ] **Step 5: ブラウザで全5画面を目視確認**

dev サーバー（`npm run dev`、localhost:5173）を Playwright MCP で開き、4つのタブ（計測/履歴/取り込み/情報）を順にクリックしてスクリーンショット。
確認事項: 背景が薄グレー・パネルが白・ボタンが青緑・文字が読める（コントラスト）・タブバーがライト配色。

- [ ] **Step 6: コミット**

```bash
git add src/styles.css index.html vite.config.js
git commit -m "実機イメージに合わせたライトテーマに刷新"
```

---

### Task 4: 履歴タブにサマリーカードと推移グラフ

**Files:**
- Modify: `index.html`（view-history セクション）
- Modify: `src/ui/historyView.js`（全面書き換え）

**Interfaces:**
- Consumes: Task 1 の `computeDelta`/`formatDelta`、Task 2 の `buildChart`/`PERIODS`/`PAD`/`CHART_W`、Task 3 のCSSクラス、既存の `METRICS`/`metricByKey`/`listMeasurements`/`deleteMeasurement`/`exportCsv`
- Produces: なし（画面）

- [ ] **Step 1: index.html の履歴セクションを更新**

変更前（index.html 45-51行目）:
```html
    <section id="view-history" class="view" hidden>
      <h2>記録の履歴</h2>
      <div class="history-actions">
        <button id="btn-export-csv" class="btn primary">CSVを書き出す</button>
      </div>
      <div id="history-list" class="history-list"></div>
    </section>
```

変更後:
```html
    <section id="view-history" class="view" hidden>
      <h2>記録の履歴</h2>
      <div id="history-summary"></div>
      <div class="trend-card" id="trend-card" hidden>
        <div class="metric-chips" id="trend-metrics"></div>
        <div class="trend-periods" id="trend-periods"></div>
        <div id="trend-chart" class="trend-chart"></div>
      </div>
      <div class="history-actions">
        <button id="btn-export-csv" class="btn primary">CSVを書き出す</button>
      </div>
      <div id="history-list" class="history-list"></div>
    </section>
```

- [ ] **Step 2: historyView.js を書き換える**

`src/ui/historyView.js` 全文:

```js
import { METRICS, metricByKey } from '../metrics.js';
import { listMeasurements, deleteMeasurement } from '../db.js';
import { exportCsv } from '../csv.js';
import { computeDelta, formatDelta } from '../trend.js';
import { buildChart, PERIODS, PAD, CHART_W } from '../chart.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createHistoryView() {
  const summaryEl = document.getElementById('history-summary');
  const trendCardEl = document.getElementById('trend-card');
  const metricsEl = document.getElementById('trend-metrics');
  const periodsEl = document.getElementById('trend-periods');
  const chartEl = document.getElementById('trend-chart');
  const listEl = document.getElementById('history-list');
  const btnExport = document.getElementById('btn-export-csv');

  let records = [];
  let selectedKey = 'weight';
  let selectedPeriod = '1m';

  function formatDate(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* ---- サマリーカード（最新値+前回比） ---- */

  function renderSummary() {
    summaryEl.innerHTML = '';
    if (records.length === 0) return;
    const latest = records[0];

    const card = document.createElement('div');
    card.className = 'summary-card';

    const date = document.createElement('div');
    date.className = 'date';
    date.textContent = `最新の測定 ${formatDate(latest.measuredAt)}`;

    const grid = document.createElement('div');
    grid.className = 'summary-grid';
    for (const m of METRICS) {
      const cell = document.createElement('div');
      cell.className = 'summary-cell' + (m.key === 'weight' ? ' main' : '');

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = m.label;

      const value = document.createElement('span');
      value.className = 'value';
      const raw = latest[m.key];
      value.textContent = raw == null || raw === '' ? 'ー' : raw;

      const unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = m.unit;

      cell.append(label, value, unit);

      // 増減の良し悪しは項目で逆（体重は減が良く骨格筋率は増が良い）なので色は付けない
      const deltaText = formatDelta(computeDelta(records, m.key), m.decimals);
      if (deltaText != null) {
        const delta = document.createElement('span');
        delta.className = 'delta';
        delta.textContent = `前回比 ${deltaText}`;
        cell.appendChild(delta);
      }
      grid.appendChild(cell);
    }

    card.append(date, grid);
    summaryEl.appendChild(card);
  }

  /* ---- 推移グラフ ---- */

  function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function svgText(content, attrs) {
    const node = el('text', attrs);
    node.textContent = content;
    return node;
  }

  function renderMetricChips() {
    metricsEl.innerHTML = '';
    for (const m of METRICS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (m.key === selectedKey ? ' selected' : '');
      b.textContent = m.label;
      b.addEventListener('click', () => {
        selectedKey = m.key;
        renderMetricChips();
        renderChart();
      });
      metricsEl.appendChild(b);
    }
  }

  function renderPeriodButtons() {
    periodsEl.innerHTML = '';
    for (const p of PERIODS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'trend-period' + (p.key === selectedPeriod ? ' selected' : '');
      b.textContent = p.label;
      b.addEventListener('click', () => {
        selectedPeriod = p.key;
        renderPeriodButtons();
        renderChart();
      });
      periodsEl.appendChild(b);
    }
  }

  function renderChart() {
    chartEl.innerHTML = '';
    const metric = metricByKey(selectedKey);
    const period = PERIODS.find((p) => p.key === selectedPeriod);
    const chart = buildChart(records, selectedKey, {
      days: period.days,
      decimals: metric.decimals,
    });

    if (!chart) {
      const p = document.createElement('p');
      p.className = 'trend-empty';
      p.textContent = 'この期間に2件以上の記録がたまるとグラフが表示されます';
      chartEl.appendChild(p);
      return;
    }

    const svg = el('svg', {
      viewBox: `0 0 ${chart.width} ${chart.height}`,
      role: 'img',
      'aria-label': `${metric.label}の推移グラフ`,
    });

    // 横グリッド線とY軸ラベル（控えめな色）
    for (const tick of chart.yTicks) {
      svg.appendChild(el('line', {
        x1: PAD.left, x2: CHART_W - PAD.right, y1: tick.y, y2: tick.y,
        stroke: 'var(--panel-2)', 'stroke-width': 1,
      }));
      svg.appendChild(svgText(tick.label, {
        x: PAD.left - 6, y: tick.y + 3,
        'text-anchor': 'end', fill: 'var(--text-dim)', 'font-size': 10,
      }));
    }

    // X軸（最初と最後の日付）
    for (const xl of chart.xLabels) {
      svg.appendChild(svgText(xl.label, {
        x: xl.x, y: chart.height - 6,
        'text-anchor': xl.anchor, fill: 'var(--text-dim)', 'font-size': 10,
      }));
    }

    // 折れ線
    svg.appendChild(el('path', {
      d: chart.path, fill: 'none',
      stroke: 'var(--accent)', 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));

    // データ点（多いときは線だけにする）
    if (chart.points.length <= 31) {
      for (const p of chart.points) {
        svg.appendChild(el('circle', { cx: p.x, cy: p.y, r: 2.5, fill: 'var(--accent)' }));
      }
    }

    // 最新点の強調と値ラベル（ラベルの文字色はテキスト色。系列色は点が担う）
    svg.appendChild(el('circle', {
      cx: chart.latest.x, cy: chart.latest.y, r: 4,
      fill: 'var(--accent)', stroke: 'var(--panel)', 'stroke-width': 2,
    }));
    svg.appendChild(svgText(chart.latest.label, {
      x: chart.latest.x, y: chart.latest.y - 8,
      'text-anchor': 'end', fill: 'var(--text)', 'font-size': 11, 'font-weight': 600,
    }));

    chartEl.appendChild(svg);
  }

  /* ---- 履歴リスト（従来どおり） ---- */

  function renderList() {
    listEl.innerHTML = '';
    if (records.length === 0) {
      const p = document.createElement('p');
      p.className = 'history-empty';
      p.textContent = 'まだ記録がありません';
      listEl.appendChild(p);
      return;
    }
    for (const r of records) {
      const item = document.createElement('div');
      item.className = 'history-item';

      const date = document.createElement('div');
      date.className = 'date';
      date.textContent = formatDate(r.measuredAt);

      const values = document.createElement('div');
      values.className = 'values';
      for (const m of METRICS) {
        if (r[m.key] == null || r[m.key] === '') continue;
        const span = document.createElement('span');
        span.textContent = `${m.label} ${r[m.key]}${m.unit}`;
        values.appendChild(span);
      }

      const del = document.createElement('button');
      del.className = 'delete';
      del.textContent = 'この記録を削除';
      del.addEventListener('click', async () => {
        if (!confirm(`${formatDate(r.measuredAt)} の記録を削除しますか？`)) return;
        await deleteMeasurement(r.id);
        render();
      });

      item.append(date, values, del);
      listEl.appendChild(item);
    }
  }

  async function render() {
    records = await listMeasurements();
    trendCardEl.hidden = records.length === 0;
    renderSummary();
    renderMetricChips();
    renderPeriodButtons();
    renderChart();
    renderList();
  }

  btnExport.addEventListener('click', async () => {
    const all = await listMeasurements();
    if (all.length === 0) {
      alert('書き出す記録がありません');
      return;
    }
    await exportCsv(all);
  });

  return {
    show() {
      render();
    },
    hide() {},
  };
}
```

- [ ] **Step 3: テストとビルドを確認**

Run: `npm test && npm run build`
Expected: 全件PASS、ビルド成功

- [ ] **Step 4: ブラウザで動作確認（0件/1件/複数件）**

Playwright MCP で localhost:5173 を開き:

1. **0件**: 履歴タブ → サマリーとグラフカードが出ず「まだ記録がありません」だけ表示される
2. **1件**: 下のコードの `for` を `i < 1` にして1件だけ投入しリロード → サマリーカードは出るが「前回比」は付かず、グラフ枠には「この期間に2件以上の記録がたまるとグラフが表示されます」が出る。確認後 `indexedDB.deleteDatabase('karadascan')` で消す
3. **複数件**: `browser_evaluate` で14日分を投入:

```js
await new Promise((resolve, reject) => {
  const req = indexedDB.open('karadascan', 1);
  req.onsuccess = () => {
    const db = req.result;
    const t = db.transaction('measurements', 'readwrite');
    const store = t.objectStore('measurements');
    const base = Date.now();
    for (let i = 0; i < 14; i++) {
      store.add({
        measuredAt: new Date(base - i * 86400000).toISOString(),
        weight: (63 + Math.sin(i / 2)).toFixed(1),
        bodyFat: (22 + Math.cos(i / 3)).toFixed(1),
        visceralFat: '8',
        skeletalMuscle: '34.3',
        bodyAge: '42',
        basalMetabolism: String(1500 + i),
        bmi: '22.4',
      });
    }
    t.oncomplete = () => resolve('ok');
    t.onerror = () => reject(t.error);
  };
  req.onerror = () => reject(req.error);
});
```

4. リロード → 履歴タブで確認:
   - サマリーカード: 体重が大きくLCD風、7項目全部に値、「前回比 ▲x.x/▼x.x/±0」が付く
   - グラフ: 折れ線が描画され、チップで体脂肪率・基礎代謝などに切替できる、期間ボタンで表示が変わる
   - 「全部」期間で骨格筋率（全点同値 34.3）→ フラットな線が出て崩れない
5. スクリーンショットを撮って保存
6. 確認後、`browser_evaluate` で `indexedDB.deleteDatabase('karadascan')` を実行してテストデータを消す

- [ ] **Step 5: コミット**

```bash
git add index.html src/ui/historyView.js
git commit -m "履歴タブに最新値サマリー（前回比つき）と推移グラフを追加"
```

---

### Task 5: 確認画面に前回値を表示

**Files:**
- Modify: `src/ui/confirmView.js`

**Interfaces:**
- Consumes: Task 1 の `previousValue`、既存の `listMeasurements`、Task 3 の `.label-wrap`/`.prev` CSS
- Produces: なし（画面）

- [ ] **Step 1: confirmView.js を修正**

import に追加:

```js
import { METRICS, validateInput } from '../metrics.js';
import { addMeasurement, listMeasurements } from '../db.js';
import { previousValue } from '../trend.js';
```

`render(results)` を async にして前回値を取得し、ラベル部分を label-wrap 構造に変更（関数全体を以下に置き換え）:

```js
  async function render(results) {
    // 前回値: 誤読チェックにも効く（前回と大きく違う値は読み間違いの可能性）
    const prev = {};
    try {
      const records = await listMeasurements();
      for (const m of METRICS) prev[m.key] = previousValue(records, m.key);
    } catch {
      // 前回値が取れなくても確認画面自体は出す
    }

    listEl.innerHTML = '';
    inputs = {};
    for (const m of METRICS) {
      const row = document.createElement('div');
      row.className = 'confirm-row' + (results[m.key] ? '' : ' missing');

      const labelWrap = document.createElement('div');
      labelWrap.className = 'label-wrap';

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = m.label;
      labelWrap.appendChild(label);

      if (prev[m.key] != null) {
        const prevEl = document.createElement('span');
        prevEl.className = 'prev';
        prevEl.textContent = `前回 ${prev[m.key].toFixed(m.decimals)}`;
        labelWrap.appendChild(prevEl);
      }

      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = results[m.key] ?? '';
      input.placeholder = '未計測';
      input.addEventListener('input', () => {
        row.classList.toggle('missing', !validateInput(input.value.trim(), m));
      });

      const unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = m.unit;

      row.append(labelWrap, input, unit);
      listEl.appendChild(row);
      inputs[m.key] = input;
    }
  }
```

`show` は変更不要（`render()` が async になっても呼びっぱなしで問題ない）。

- [ ] **Step 2: テストとビルドを確認**

Run: `npm test && npm run build`
Expected: 全件PASS、ビルド成功

- [ ] **Step 3: ブラウザで確認**

Playwright MCP で Task 4 と同じテストデータを投入し、取り込みタブ→（ファイルなしでも）確認画面を出すのは手間なので、`browser_evaluate` は使わず次の簡易手順にする:
記録がある状態で計測タブ「読み取り開始」→「ここで終了して確認」で確認画面を開き、各行のラベル下に「前回 63.4」等が薄く表示されることを確認。カメラが使えない環境なら、取り込みタブで適当な静止画を読ませて「結果を確認」でも良い。
確認後 `indexedDB.deleteDatabase('karadascan')` でテストデータを消す。

- [ ] **Step 4: コミット**

```bash
git add src/ui/confirmView.js
git commit -m "確認画面に前回値を表示（誤読チェックにも活用）"
```

---

### Task 6: 総合検証とデプロイ

**Files:** なし（検証のみ。修正が出た場合はそのファイル）

- [ ] **Step 1: 全テスト+ビルド**

Run: `npm test && npm run build`
Expected: 全件PASS、ビルド成功

- [ ] **Step 2: 実機動画の回帰確認（読み取りに影響がないこと）**

読み取りエンジンには触っていないが、UI変更で取り込みフローが壊れていないことを Playwright MCP で確認:
`/Users/adlibmacmini2021/Downloads/IMG_2592.MOV` を `public/` にコピーせず、file input に直接 `browser_file_upload` で渡す → 取り込み実行 → 7項目（63.3 / 22.9 / 8 / 34.3 / 42 / 1507 / 22.4）が読めること。
**動画ファイルをコミットしないこと（public/ にコピーした場合は必ず削除）。**

- [ ] **Step 3: 最終スクリーンショット一式**

ライトテーマの計測/履歴（テストデータ入り）/取り込み/情報の4画面 + 確認画面のスクリーンショットを撮り、ユーザーに提示する。テストデータは最後に削除。

- [ ] **Step 4: プッシュとデプロイ確認**

```bash
git push
gh run list --repo qnosuke/krd-scan --limit 1
```

Actions の成功を待ち、ライブ確認:

```bash
curl -s https://qnosuke.github.io/krd-scan/ | shasum
shasum dist/index.html
```

Expected: 2つのハッシュが一致（配信反映済み）

- [ ] **Step 5: メモリ更新**

`karadascan-project-state.md` に「ライトテーマ+推移グラフ+前回比を実装・デプロイ済み（コミットID）、iPhone実機での見た目確認待ち」を追記。
