import { METRICS, metricByKey, validateInput } from '../metrics.js';
import { listMeasurements, deleteMeasurement, addMeasurements } from '../db.js';
import { exportCsv } from '../csv.js';
import { computeDelta, formatDelta, previousValue } from '../trend.js';
import { buildChart, PERIODS, PAD, CHART_W } from '../chart.js';
import { parseCsvText, dedupeByDateKey } from '../csvImport.js';
import { GOAL_KEYS, loadGoals, saveGoals, goalStatus, formatGoalStatus } from '../goals.js';
import { dateKeyOf, groupByDay, dailyLatest } from '../daily.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createHistoryView() {
  const summaryEl = document.getElementById('history-summary');
  const goalsEl = document.getElementById('history-goals');
  const trendCardEl = document.getElementById('trend-card');
  const metricsEl = document.getElementById('trend-metrics');
  const periodsEl = document.getElementById('trend-periods');
  const chartEl = document.getElementById('trend-chart');
  const listEl = document.getElementById('history-list');
  const btnExport = document.getElementById('btn-export-csv');
  const btnImport = document.getElementById('btn-import-csv');
  const importFileEl = document.getElementById('import-csv-file');

  let records = [];
  let selectedKey = 'weight';
  let selectedPeriod = '1m';
  let editingGoals = false;

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

    // 「今日は測定済みか」の視覚フィードバック
    const measuredToday = dateKeyOf(latest.measuredAt) === dateKeyOf(new Date().toISOString());
    const today = document.createElement('div');
    today.className = 'today-chip' + (measuredToday ? ' done' : '');
    today.textContent = measuredToday ? '✓ 今日は測定済み' : '今日はまだ測定していません';

    card.append(today, date, grid);
    summaryEl.appendChild(card);
  }

  /* ---- 目標カード ---- */

  function renderGoals() {
    goalsEl.innerHTML = '';
    const goals = loadGoals();
    const hasGoals = GOAL_KEYS.some((k) => goals[k] != null);

    const card = document.createElement('div');
    card.className = 'goal-card';

    if (editingGoals) {
      const title = document.createElement('div');
      title.className = 'goal-title';
      title.textContent = '🎯 目標';

      const form = document.createElement('div');
      form.className = 'goal-form';
      const inputs = {};
      for (const key of GOAL_KEYS) {
        const m = metricByKey(key);
        const row = document.createElement('label');
        row.className = 'goal-edit-row';

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = m.label;

        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.value = goals[key] ?? '';
        input.placeholder = '未設定';

        const unit = document.createElement('span');
        unit.className = 'unit';
        unit.textContent = m.unit;

        row.append(label, input, unit);
        form.appendChild(row);
        inputs[key] = input;
      }

      const actions = document.createElement('div');
      actions.className = 'goal-actions';

      const btnSave = document.createElement('button');
      btnSave.type = 'button';
      btnSave.className = 'btn primary';
      btnSave.textContent = '保存';
      btnSave.addEventListener('click', () => {
        const next = {};
        for (const key of GOAL_KEYS) {
          const m = metricByKey(key);
          const raw = inputs[key].value.trim();
          if (raw === '') continue; // 空 = その項目の目標を解除
          if (!validateInput(raw, m)) {
            alert(`「${m.label}」の目標値 ${raw} が範囲外です（${m.min}〜${m.max}）`);
            inputs[key].focus();
            return;
          }
          next[key] = raw;
        }
        saveGoals(next);
        editingGoals = false;
        renderGoals();
      });

      const btnCancel = document.createElement('button');
      btnCancel.type = 'button';
      btnCancel.className = 'btn';
      btnCancel.textContent = 'キャンセル';
      btnCancel.addEventListener('click', () => {
        editingGoals = false;
        renderGoals();
      });

      actions.append(btnSave, btnCancel);
      card.append(title, form, actions);
    } else if (!hasGoals) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'link-btn';
      btn.textContent = '🎯 目標を設定する';
      btn.addEventListener('click', () => {
        editingGoals = true;
        renderGoals();
      });
      card.appendChild(btn);
    } else {
      const head = document.createElement('div');
      head.className = 'goal-head';

      const title = document.createElement('span');
      title.className = 'goal-title';
      title.textContent = '🎯 目標';

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'link-btn';
      btnEdit.textContent = '編集';
      btnEdit.addEventListener('click', () => {
        editingGoals = true;
        renderGoals();
      });

      head.append(title, btnEdit);
      card.appendChild(head);

      for (const key of GOAL_KEYS) {
        if (goals[key] == null) continue;
        const m = metricByKey(key);
        const row = document.createElement('div');
        row.className = 'goal-row';

        const label = document.createElement('span');
        label.textContent = `${m.label} 目標 ${goals[key]}${m.unit}`;
        row.appendChild(label);

        // 直近の測定値（値がある最新レコード）との差。記録がなければ目標値のみ表示
        const st = goalStatus(previousValue(records, key), goals[key]);
        const statusText = formatGoalStatus(st, m);
        if (statusText != null) {
          const status = document.createElement('span');
          status.className = 'goal-status' + (st.achieved ? ' achieved' : '');
          status.textContent = statusText;
          row.appendChild(status);
        }
        card.appendChild(row);
      }
    }

    goalsEl.appendChild(card);
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
    const chart = buildChart(dailyLatest(records), selectedKey, {
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

  /* ---- 履歴リスト（日付グループ表示） ---- */

  function formatTime(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

  function formatDayHeading(group) {
    const d = new Date(group.latest.measuredAt);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}（${DAY_NAMES[d.getDay()]}）・${group.records.length}件`;
  }

  function renderList() {
    listEl.innerHTML = '';
    if (records.length === 0) {
      const p = document.createElement('p');
      p.className = 'history-empty';
      p.textContent = 'まだ記録がありません';
      listEl.appendChild(p);
      return;
    }
    for (const group of groupByDay(records)) {
      const heading = document.createElement('div');
      heading.className = 'history-day';
      heading.textContent = formatDayHeading(group);
      listEl.appendChild(heading);

      for (const r of group.records) {
        const item = document.createElement('div');
        item.className = 'history-item';

        const date = document.createElement('div');
        date.className = 'date';
        date.textContent = formatTime(r.measuredAt);

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
  }

  async function render() {
    records = await listMeasurements();
    trendCardEl.hidden = records.length === 0;
    renderSummary();
    renderGoals();
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

  btnImport.addEventListener('click', () => importFileEl.click());

  importFileEl.addEventListener('change', async () => {
    const file = importFileEl.files?.[0];
    importFileEl.value = ''; // 同じファイルをもう一度選べるようにする
    if (!file) return;

    let text;
    try {
      text = await file.text();
    } catch {
      // 選択後にファイルが移動・削除されると読み取りに失敗する（iOS のクラウド経由など）
      alert('ファイルを読み込めませんでした。もう一度お試しください');
      return;
    }

    const parsed = parseCsvText(text);
    if (!parsed.ok) {
      alert(`読み込めませんでした。\n${parsed.error.line}行目: ${parsed.error.reason}`);
      return;
    }
    if (parsed.records.length === 0) {
      alert('取り込める記録がありませんでした');
      return;
    }

    const existing = await listMeasurements();
    const { fresh, skipped } = dedupeByDateKey(parsed.records, existing);
    if (fresh.length === 0) {
      alert(`すべて登録済みでした（${skipped}件重複）`);
      return;
    }

    const msg =
      skipped > 0
        ? `${fresh.length}件を追加します（${skipped}件は登録済みのためスキップ）。よろしいですか？`
        : `${fresh.length}件を追加します。よろしいですか？`;
    if (!confirm(msg)) return;

    try {
      await addMeasurements(fresh);
    } catch (e) {
      // 1トランザクションなので部分書き込みは起きていない
      console.error(e);
      alert('保存に失敗しました。もう一度お試しください');
      return;
    }
    await render();
    alert(`${fresh.length}件を追加しました`);
  });

  return {
    show() {
      render();
    },
    hide() {},
  };
}
