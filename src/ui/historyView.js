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
