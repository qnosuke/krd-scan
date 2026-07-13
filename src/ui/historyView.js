import { METRICS } from '../metrics.js';
import { listMeasurements, deleteMeasurement } from '../db.js';
import { exportCsv } from '../csv.js';

export function createHistoryView() {
  const listEl = document.getElementById('history-list');
  const btnExport = document.getElementById('btn-export-csv');

  function formatDate(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function render() {
    const records = await listMeasurements();
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

  btnExport.addEventListener('click', async () => {
    const records = await listMeasurements();
    if (records.length === 0) {
      alert('書き出す記録がありません');
      return;
    }
    await exportCsv(records);
  });

  return {
    show() {
      render();
    },
    hide() {},
  };
}
